import { WorkflowEntrypoint } from 'cloudflare:workers';

import { Hono } from 'hono';
const app = new Hono();

const pagerduty_alert_url = 'https://events.pagerduty.com/v2/enqueue';
const cf_api_url = 'https://api.cloudflare.com/client/v4';

export class AlertWorkflow extends WorkflowEntrypoint {
    async run(event, step) {

        const alert = await step.do('create alert', { retries: { limit: 1, delay: 1000 } }, async () => {
            const body = event.payload;

            const alert_name = body.data.name;
            const service_name = alert_name.split('-')[0];
            const service_component = alert_name.split('-')[1];
            const key = this.env[`KEY_${service_name}`];

            let severity = 'critical';
            let action = 'trigger';

            // 'Healthy' notifications should not create a page, so set severity to info.
            // If all health checks for this service are healthy, resolve the incident.
            // If we don't have a CF API token, do nothing.
            if (body.data.status === 'Healthy') {
                severity = 'info';
                console.info('got healthy notification for ' + alert_name);

                // Call the Cloudflare API to get the status of all health checks.
                // This should be retried several times, but if it ultimately fails,
                // we should continue with the workflow and send the alert anyway.
                if (this.env.CF_API_TOKEN && this.env.CF_ZONE_ID) {
                    let resolve = false;
                    try {
                        resolve = await step.do('call cloudflare api', {
                            retries: {
                                limit: 5,
                                delay: 5000,
                                backoff: 'linear',
                            },
                            timeout: '5 minutes',
                        }, async () => {

                                const url = `${cf_api_url}/zones/${this.env.CF_ZONE_ID}/healthchecks`;
                                const response = await fetch(url, {
                                    method: 'GET',
                                    headers: {
                                        'Authorization': 'Bearer ' + this.env.CF_API_TOKEN,
                                    },
                                });

                                const json = await response.json();

                                if (json.success !== true) {
                                    console.error('Cloudflare API error:', json.errors[0].code, json.errors[0].message);
                                    throw new Error('Cloudflare API error: ' + json.errors[0].message);
                                }

                                let all_healthy = true;
                                for (let i = 0; i < json.result.length; i++) {
                                    const result = json.result[i];
                                    // We are calling the API so quickly that sometimes it hasn't caught up
                                    // and still thinks the service is down, so skip the service we just
                                    // got a notification for.
                                    if (result.name === alert_name) {
                                        continue;
                                    }
                                    if (result.name.split('-')[0] === service_name) {
                                        if (result.status !== 'healthy') {
                                            all_healthy = false;
                                            console.info(result.name + ' is not healthy');
                                            break;
                                        }
                                    }
                                }
                                return all_healthy;
                            }); // end of step.do
                    } catch (e) {
                        console.error(e.message);
                        resolve = false;
                    }

                    if (resolve) {
                        console.log('all healthy, resolving incident');
                        action = 'resolve';
                    }
                } else {
                    console.warn('no CF_API_TOKEN or CF_ZONE_ID, not checking other health checks');
                }
            } else {
                console.info('got unhealthy notification for ' + alert_name);
            }

            return {
                routing_key: key,
                event_action: action,
                dedup_key: service_name,
                payload: {
                    summary: `${alert_name} is ${body.data.status}: ${body.data.reason}`,
                    source: service_name,
                    severity: severity,
                    component: service_component,
                },
            };
        }); // end of step.do

        await step.do('send pagerduty alert', {
            retries: {
                limit: 20,
                delay: 5000,
                backoff: 'linear',
            },
            timeout: '30 minutes',
        }, async () => {
                const res = await fetch(pagerduty_alert_url, {
                    method: 'POST',
                    body: JSON.stringify(alert),
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });

                if (res.ok) {
                    console.info('PagerDuty alert sent');
                    return;
                }
                const json = await res.json();
                const message = json.message || 'unknown error';
                console.error('PagerDuty error: ' + message);
                throw new Error('PagerDuty error: ' + message);
            }); // end of step.do

        console.info('workflow complete');
        return true; // workflows beta bug workaround, maybe not necessary
    }
}

app.get('/', () => {
    return new Response("I'm a teapot.", { status: 418 });
});

app.post('/alert', async (c) => {
    if (c.req.header("cf-webhook-auth") !== c.env.WEBHOOK_SECRET) {
        return c.text('unauthorized', { status: 401 });
    }

    const body = await c.req.json();
    console.log(body);

    // body looks like this:
    // {
    //   name: 'test',
    //   text: 'Freeform text version of alert data',
    //   data: {
    //     time: '2023-08-12 05:16:49 +0000 UTC',
    //     status: 'Unhealthy',
    //     reason: 'TCP connection failed',
    //     name: 'scandal-web',
    //     preview: false,
    //     expected_codes: '',
    //     actual_code: 0,
    //     health_check_id: '5334d6fbfc9f170315cc51e29e8a350a'
    //   },
    //   ts: 1691817413,
    //   alert_type: 'health_check_status_notification'
    // }

    // If body.text starts with 'Hello World!' then it's a test notification.
    // Cloudflare will send this when you create a new webhook, and will refuse
    // to create the webhook if we don't respond with success.
    // So we accept it and do nothing.
    if (body.text.startsWith('Hello World!')) {
        console.info('test notification');
        return c.text('ok');
    }

    if (body.alert_type !== 'health_check_status_notification') {
        console.error('bad request:', body);
        return c.text('bad request', { status: 400 });
    }

    // name the alert like service-component
    // e.g. foo-web, foo-smtp
    // Put the PagerDuty service key in the environment variable KEY_foo
    const alert_name = body.data.name;
    const service_name = alert_name.split('-')[0];
    const key = c.env[`KEY_${service_name}`];
    if (!key) {
        console.error('service not found:', service_name);
        return c.text(`service ${service_name} not found`, { status: 400 });
    }

    let instance = await c.env.WORKFLOW.create({ params: body });
    const status = await instance.status();
    console.info('created workflow:', instance.id, status);
    return c.text('ok');
});

export default app;
