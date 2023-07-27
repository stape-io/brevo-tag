const sendHttpRequest = require('sendHttpRequest');
const JSON = require('JSON');
const getCookieValues = require('getCookieValues');
const setCookie = require('setCookie');
const getContainerVersion = require('getContainerVersion');
const logToConsole = require('logToConsole');
const getRequestHeader = require('getRequestHeader');
const makeTableMap = require('makeTableMap');

const isLoggingEnabled = determinateIsLoggingEnabled();
const traceId = isLoggingEnabled ? getRequestHeader('trace-id') : undefined;

let email = data.email;

if (!email) {
  email = getCookieValues('brevo_email')[0];
} else {
  storeCookie('email', email);
}

if (data.type === 'trackPage') {
  sendEvent('page_view', {
    'properties': data.properties ? makeTableMap(data.properties, 'name', 'value') : {},
    'email': email,
    'page': data.page
  });
} else if (data.type === 'trackEvent') {
  sendEvent(data.event, {
    'properties': data.properties ? makeTableMap(data.properties, 'name', 'value') : {},
    'eventData': data.propertiesEvent ? makeTableMap(data.propertiesEvent, 'name', 'value') : {},
    'email': email,
    'event': data.event
  });
} else if (data.type === 'trackLink') {
  sendEvent('link', {
    'properties': data.properties ? makeTableMap(data.properties, 'name', 'value') : {},
    'email': email,
    'link': data.link
  });
} else {
  sendEvent('identify', {
    'attributes': data.customerProperties ? makeTableMap(data.customerProperties, 'name', 'value') : {},
    'email': email
  });
}

function sendEvent(eventName, brevoEventData) {
  let url = 'https://in-automate.brevo.com/api/v2/' + data.type;

  if (isLoggingEnabled) {
    logToConsole(
      JSON.stringify({
        Name: 'Brevo',
        Type: 'Request',
        TraceId: traceId,
        EventName: eventName,
        RequestMethod: 'POST',
        RequestUrl: url,
        RequestBody: brevoEventData,
      })
    );
  }

  sendHttpRequest(
    url,
    (statusCode, headers, body) => {
      logToConsole(
        JSON.stringify({
          Name: 'Brevo',
          Type: 'Response',
          TraceId: traceId,
          EventName: eventName,
          ResponseStatusCode: statusCode,
          ResponseHeaders: headers,
          ResponseBody: body,
        })
      );

      if (!data.useOptimisticScenario) {
        if (statusCode >= 200 && statusCode < 300) {
          data.gtmOnSuccess();
        } else {
          data.gtmOnFailure();
        }
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'ma-key': data.clientKey,
      },
      method: 'POST'
    },
    JSON.stringify(brevoEventData)
  );

  if (data.useOptimisticScenario) {
    data.gtmOnSuccess();
  }
}

function storeCookie(name, value) {
  setCookie('brevo_' + name, value, {
    domain: 'auto',
    path: '/',
    samesite: 'Lax',
    secure: true,
    'max-age': 63072000, // 2 years
    httpOnly: false,
  });
}

function determinateIsLoggingEnabled() {
  const containerVersion = getContainerVersion();
  const isDebug = !!(
    containerVersion &&
    (containerVersion.debugMode || containerVersion.previewMode)
  );

  if (!data.logType) {
    return isDebug;
  }

  if (data.logType === 'no') {
    return false;
  }

  if (data.logType === 'debug') {
    return isDebug;
  }

  return data.logType === 'always';
}
