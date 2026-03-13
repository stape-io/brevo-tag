const getAllEventData = require('getAllEventData');
const getCookieValues = require('getCookieValues');
const getRequestHeader = require('getRequestHeader');
const getType = require('getType');
const getContainerVersion = require('getContainerVersion');
const JSON = require('JSON');
const logToConsole = require('logToConsole');
const makeTableMap = require('makeTableMap');
const sendHttpRequest = require('sendHttpRequest');
const setCookie = require('setCookie');

/*==============================================================================
==============================================================================*/

const eventData = getAllEventData();

if (shouldExitEarly(data, eventData)) return;

// Fallback to V2, which is the one being used in the Gallery when this change was made.
const API_VERSION = data.apiVersion || 'v2';

let email = data.email;
if (data.storeEmail) {
  if (!email) email = getCookieValues('brevo_email')[0];
  else storeCookie('email', email);
}

switch (data.type) {
  case 'trackPage':
    sendEvent('page_view', formatEventPayloadByApiVersion('trackPage'));
    break;
  case 'trackEvent':
    sendEvent(data.event, formatEventPayloadByApiVersion('trackEvent'));
    break;
  case 'trackLink':
    sendEvent('link', formatEventPayloadByApiVersion('trackLink'));
    break;
  case 'identify':
    sendEvent('identify', formatEventPayloadByApiVersion('identify'));
    break;
  default:
    return data.gtmOnFailure();
}

/*==============================================================================
  Vendor related functions
==============================================================================*/

function sendEvent(eventName, brevoEventData) {
  if (areThereRequiredFieldsMissing(brevoEventData)) {
    log({
      Name: 'Brevo',
      Type: 'Message',
      EventName: eventName,
      Message: '🛑 [ERROR] Request was not sent. API ' + API_VERSION,
      Reason: 'One or more fields are missing: v2: Email; v3: Email, Phone Number or External ID.'
    });
    return data.gtmOnFailure();
  }

  const url = getRequestUrl();

  log({
    Name: 'Brevo',
    Type: 'Request',
    EventName: eventName,
    RequestMethod: 'POST',
    RequestUrl: url,
    RequestBody: brevoEventData
  });

  sendHttpRequest(
    url,
    (statusCode, headers, body) => {
      log({
        Name: 'Brevo',
        Type: 'Response',
        EventName: eventName,
        ResponseStatusCode: statusCode,
        ResponseHeaders: headers,
        ResponseBody: body
      });

      if (!data.useOptimisticScenario) {
        if (statusCode >= 200 && statusCode < 300) return data.gtmOnSuccess();
        return data.gtmOnFailure();
      }
    },
    {
      headers: getRequestHeaders(),
      method: 'POST'
    },
    JSON.stringify(brevoEventData)
  );

  if (data.useOptimisticScenario) return data.gtmOnSuccess();
}

function formatEventPayloadByApiVersion(event) {
  const eventPayloadByApiVersion = {
    v2: {
      trackPage: () => ({
        properties: data.properties ? makeTableMap(data.properties, 'name', 'value') : {},
        email: email,
        page: data.page
      }),
      trackEvent: () => ({
        properties: data.properties ? makeTableMap(data.properties, 'name', 'value') : {},
        eventData: data.propertiesEvent ? makeTableMap(data.propertiesEvent, 'name', 'value') : {},
        email: email,
        event: data.event
      }),
      trackLink: () => ({
        properties: data.properties ? makeTableMap(data.properties, 'name', 'value') : {},
        email: email,
        link: data.link
      }),
      identify: () => ({
        attributes: data.customerProperties
          ? makeTableMap(data.customerProperties, 'name', 'value')
          : {},
        email: email
      })
    },
    v3: {
      trackPage: () => ({
        event_name: 'page_view',
        identifiers: mergeObj(
          { email_id: email },
          data.customerIdentifiers ? makeTableMap(data.customerIdentifiers, 'name', 'value') : {}
        ),
        event_properties: data.properties ? makeTableMap(data.properties, 'name', 'value') : {},
        page: data.page
      }),
      trackEvent: () => ({
        event_name: data.event,
        identifiers: mergeObj(
          { email_id: email },
          data.customerIdentifiers ? makeTableMap(data.customerIdentifiers, 'name', 'value') : {}
        ),
        contact_properties: data.properties ? makeTableMap(data.properties, 'name', 'value') : {},
        event_properties: data.propertiesEvent
          ? makeTableMap(data.propertiesEvent, 'name', 'value')
          : {}
      }),
      trackLink: () => ({
        event_name: 'link',
        identifiers: mergeObj(
          { email_id: email },
          data.customerIdentifiers ? makeTableMap(data.customerIdentifiers, 'name', 'value') : {}
        ),
        event_properties: data.properties ? makeTableMap(data.properties, 'name', 'value') : {},
        link: data.link
      }),
      identify: () => ({
        event_name: 'identify',
        identifiers: mergeObj(
          { email_id: email },
          data.customerIdentifiers ? makeTableMap(data.customerIdentifiers, 'name', 'value') : {}
        ),
        contact_properties: data.customerProperties
          ? makeTableMap(data.customerProperties, 'name', 'value')
          : {}
      })
    }
  };

  return eventPayloadByApiVersion[API_VERSION][event]();
}

function areThereRequiredFieldsMissing(brevoEventData) {
  const requiredFieldsValidationByApiVersion = {
    v2: () => {
      if (!isValidValue(brevoEventData.email)) return true;
      return false;
    },
    v3: () => {
      const doesNotHaveValidIdentifier = ['email_id', 'phone_id', 'ext_id'].every(
        (p) => !isValidValue(brevoEventData.identifiers[p])
      );
      if (doesNotHaveValidIdentifier) return true;
      return false;
    }
  };
  return requiredFieldsValidationByApiVersion[API_VERSION]();
}

function getRequestUrl() {
  const baseUrlByApiVersion = {
    v2: 'https://in-automate.brevo.com/api/v2/' + data.type,
    v3: 'https://api.brevo.com/v3/events'
  };
  return baseUrlByApiVersion[API_VERSION];
}

function getRequestHeaders() {
  const baseHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  const headersByApiVersion = {
    v2: { 'ma-key': data.clientKey },
    v3: { 'api-key': data.clientKey }
  };
  return mergeObj(baseHeaders, headersByApiVersion[API_VERSION]);
}

function storeCookie(name, value) {
  setCookie('brevo_' + name, value, {
    domain: 'auto',
    path: '/',
    samesite: 'Lax',
    secure: true,
    'max-age': 63072000, // 2 years
    httpOnly: false
  });
}

/*==============================================================================
  Helpers
==============================================================================*/

function getUrl(eventData) {
  return eventData.page_location || getRequestHeader('referer') || eventData.page_referrer;
}

function shouldExitEarly(data, eventData) {
  if (!isConsentGivenOrNotRequired(data, eventData)) {
    data.gtmOnSuccess();
    return true;
  }

  const url = getUrl(eventData);
  if (url && url.lastIndexOf('https://gtm-msr.appspot.com/', 0) === 0) {
    data.gtmOnSuccess();
    return true;
  }
}

function isValidValue(value) {
  const valueType = getType(value);
  return valueType !== 'null' && valueType !== 'undefined' && value !== '' && value === value;
}

function mergeObj(target, source) {
  for (const key in source) {
    if (source.hasOwnProperty(key)) target[key] = source[key];
  }
  return target;
}

function isConsentGivenOrNotRequired(data, eventData) {
  if (data.adStorageConsent !== 'required') return true;
  if (eventData.consent_state) return !!eventData.consent_state.ad_storage;
  const xGaGcs = eventData['x-ga-gcs'] || ''; // x-ga-gcs is a string like "G110"
  return xGaGcs[2] === '1';
}

function log(rawDataToLog) {
  if (!determinateIsLoggingEnabled()) return;

  rawDataToLog.TraceId = getRequestHeader('trace-id');
  logToConsole(JSON.stringify(rawDataToLog));
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
