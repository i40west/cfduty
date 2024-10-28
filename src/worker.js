import { Hono } from 'hono';
const app = new Hono();

const pagerduty_alert_url = 'https://events.pagerduty.com/v2/enqueue';
const cf_api_url = 'https://api.cloudflare.com/client/v4';

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
    const service_component = alert_name.split('-')[1];
    const key = c.env[`KEY_${service_name}`];
    if (!key) {
        console.error('service not found:', service_name);
        return c.text(`service ${service_name} not found`, { status: 400 });
    }

    // 'Healthy' notifications should not create a page, so set severity to info.
    // If all health checks for this service are healthy, resolve the incident.
    // If we don't have the token, or the call fails, just do nothing.
    let severity = 'critical';
    let action = 'trigger';
    if (body.data.status === 'Healthy') {
        severity = 'info';
        console.info('got healthy notification for ' + alert_name);

        if (c.env.CF_API_TOKEN && c.env.CF_ZONE_ID) {
            // Call the Cloudflare API to get the status of all health checks
            const url = `${cf_api_url}/zones/${c.env.CF_ZONE_ID}/healthchecks`;
            await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + c.env.CF_API_TOKEN,
                },
            })
            .then(res => res.json())
            .then(json => {
                let all_healthy = true;
                for (let i = 0; i < json.result.length; i++) {
                    const result = json.result[i];
                    if (result.name.split('-')[0] === service_name) {
                        if (result.status !== 'healthy') {
                            all_healthy = false;
                            console.info(result.name + ' is not healthy');
                            break;
                        }
                    }
                }
                if (all_healthy) {
                    console.log('all healthy, resolving incident');
                    action = 'resolve';
                }
            })
            .catch(err => {
                console.error('error calling cloudflare api: ' + err);
            });
        }
    } else {
        console.info('got unhealthy notification for ' + alert_name);
    }

    const alert = {
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

    const res = await fetch(pagerduty_alert_url, {
        method: 'POST',
        body: JSON.stringify(alert),
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (res.ok) {
        return c.text('ok');
    }
    const json = await res.json();
    const message = json.message || 'unknown error';
    return c.text('PagerDuty error: ' + message, { status: res.status });
});

export default app;
