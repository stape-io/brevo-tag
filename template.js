const getAllEventData = require('getAllEventData');
const getCookieValues = require('getCookieValues');
const getRequestHeader = require('getRequestHeader');
const getTimestampMillis = require('getTimestampMillis');
const getType = require('getType');
const JSON = require('JSON');
const logToConsole = require('logToConsole');
const makeNumber = require('makeNumber');
const makeString = require('makeString');
const makeTableMap = require('makeTableMap');
const Math = require('Math');
const sendHttpRequest = require('sendHttpRequest');
const setCookie = require('setCookie');

/*==============================================================================
==============================================================================*/

const eventData = getAllEventData();

if (shouldExitEarly(data, eventData)) return;

// Fallback to V2, which is the one being used in the Gallery when this change was made.
const API_VERSION = data.type === 'trackOrder' ? 'v3' : data.apiVersion || 'v2';

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
  case 'trackOrder':
    sendEvent('trackOrder', formatEventPayloadByApiVersion('trackOrder'));
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
      Reason:
        'One or more fields are missing or invalid: v2: Email; v3: Email, Phone Number or External ID; Order: ID, Amount, Status, Products, and Created At / Updated At.'
    });
    return data.gtmOnFailure();
  }

  const url = getRequestUrl();
  sendHttpRequest(
    url,
    (statusCode, headers, body) => {
      if (!data.useOptimisticScenario) {
        // The Orders API documents 204 as its only success response.
        const isSuccess =
          data.type === 'trackOrder' ? statusCode === 204 : statusCode >= 200 && statusCode < 300;
        if (isSuccess) return data.gtmOnSuccess();
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
      }),
      trackOrder: () => {
        const orderPayload = mergeObj(
          getRequiredOrderParams(data, eventData),
          getOptionalOrderParams(data)
        );
        const identifiers = getUserDataIdentifiers(data, eventData);
        const hasIdentifier = ['email_id', 'phone_id', 'ext_id'].some((p) =>
          isValidValue(identifiers[p])
        );
        if (hasIdentifier) orderPayload.identifiers = identifiers;
        return orderPayload;
      }
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
      if (data.type === 'trackOrder') {
        const hasInvalidRequiredOrderParameter =
          ['id', 'amount', 'status'].some((param) => !isValidValue(brevoEventData[param])) ||
          ['createdAt', 'updatedAt'].some((date) => !isValidUTCDate(brevoEventData[date])) ||
          areThereInvalidOrderProducts(brevoEventData.products);
        return hasInvalidRequiredOrderParameter;
      }

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
    v3:
      data.type === 'trackOrder'
        ? 'https://api.brevo.com/v3/orders/status'
        : 'https://api.brevo.com/v3/events'
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

function getUserDataIdentifiers(data, eventData) {
  const userIdentifiers = mergeObj(
    { email: email },
    data.customerIdentifiers ? makeTableMap(data.customerIdentifiers, 'name', 'value') : {}
  );
  const userData = eventData.user_data || {};
  const autoMap = data.autoMapEventData;
  return {
    email_id:
      userIdentifiers.email ||
      (autoMap
        ? getFirstUnhashedValue([
            eventData.email,
            eventData.email_address,
            userData.email,
            userData.email_address
          ])
        : undefined),
    ext_id: userIdentifiers.ext_id || (autoMap ? eventData.user_id || userData.user_id : undefined),
    phone_id:
      userIdentifiers.phone_id ||
      (autoMap
        ? getFirstValidPhoneNumber([
            eventData.phone,
            eventData.phone_number,
            userData.phone_number,
            userData.phone
          ])
        : undefined)
  };
}

function getOrderProducts(data, eventData) {
  const rawProducts =
    data.products || (data.autoMapEventData ? eventData.items || eventData.products : []);
  if (getType(rawProducts) !== 'array') return [];

  return rawProducts
    .filter((product) => getType(product) === 'object')
    .map((product) => {
      const productId = product.productId || product.item_id;
      const quantity = makeNumber(product.quantity || product.quantityFloat || 1);
      return {
        productId: isValidValue(productId) ? makeString(productId) : undefined,
        variantId: product.variantId || product.variant_id || product.item_variant,
        price: makeNumber(isValidValue(product.price) ? product.price : product.item_price),
        quantity: !isFloatNumber(quantity) ? quantity : undefined,
        quantityFloat: isFloatNumber(quantity) ? quantity : undefined
      };
    });
}

function areThereInvalidOrderProducts(products) {
  if (getType(products) !== 'array' || products.length === 0) return true;
  return products.some(
    (product) =>
      !isValidValue(product.productId) ||
      !isValidValue(product.price) ||
      (!isValidValue(product.quantity) && !isValidValue(product.quantityFloat))
  );
}

function getOptionalOrderParams(data) {
  const properties = data.properties ? makeTableMap(data.properties, 'name', 'value') : {};
  const optionalOrderParams = {};

  if (getType(properties.billing) === 'object') optionalOrderParams.billing = properties.billing;
  if (getType(properties.coupons) === 'array') optionalOrderParams.coupons = properties.coupons;
  if (getType(properties.metaInfo) === 'object') optionalOrderParams.metaInfo = properties.metaInfo;
  if (isValidValue(properties.storeId))
    optionalOrderParams.storeId = makeString(properties.storeId);

  return optionalOrderParams;
}

function getRequiredOrderParams(data, eventData) {
  const now = convertTimestampToISO(getTimestampMillis());
  const requiredParams = {
    id: data.orderId || (data.autoMapEventData ? eventData.transaction_id : undefined),
    amount: makeNumber(data.amount || (data.autoMapEventData ? eventData.value : undefined)),
    status: data.status,
    products: getOrderProducts(data, eventData),
    createdAt: isValidValue(data.createdAt) ? data.createdAt : now,
    updatedAt: isValidValue(data.updatedAt) ? data.updatedAt : now
  };

  return requiredParams;
}

/*==============================================================================
  Helpers
==============================================================================*/

function isValidUTCDate(date) {
  return (
    getType(date) === 'string' &&
    date.match('^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$') !== null
  );
}

function getFirstUnhashedValue(values) {
  return values.filter((value) => isValidValue(value) && !isHashed(value))[0];
}

function getFirstValidPhoneNumber(values) {
  return values.filter(isValidValue).map(normalizePhoneNumber).filter(isValidValue)[0];
}

function normalizePhoneNumber(phoneNumber) {
  phoneNumber = makeString(phoneNumber)
    .split(' ')
    .join('')
    .split('-')
    .join('')
    .split('.')
    .join('')
    .split('(')
    .join('')
    .split(')')
    .join('');
  if (isHashed(phoneNumber)) return;
  if (phoneNumber[0] !== '+') phoneNumber = '+' + phoneNumber;
  if (phoneNumber.match('^\\+[1-9][0-9]{1,14}$') === null) return;
  return phoneNumber;
}

function isHashed(value) {
  return makeString(value).match('^[A-Fa-f0-9]{64}$') !== null;
}

function isFloatNumber(number) {
  number = makeNumber(number);
  if (!isValidValue(number)) return false;
  if (Math.floor(number) === number) return false;
  return true;
}

function convertTimestampToISO(timestamp) {
  const leapYear = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const nonLeapYear = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const secToMs = (s) => s * 1000;
  const minToMs = (m) => m * secToMs(60);
  const hoursToMs = (h) => h * minToMs(60);
  const daysToMs = (d) => d * hoursToMs(24);
  const padStart = (value, length) => {
    let result = makeString(value);
    while (result.length < length) {
      result = '0' + result;
    }
    return result;
  };

  const fourYearsInMs = daysToMs(365 * 4 + 1);
  let year = 1970 + Math.floor(timestamp / fourYearsInMs) * 4;
  timestamp = timestamp % fourYearsInMs;

  while (true) {
    let isLeapYear = year % 4 === 0;
    let nextTimestamp = timestamp - daysToMs(isLeapYear ? 366 : 365);
    if (nextTimestamp < 0) {
      break;
    }
    timestamp = nextTimestamp;
    year = year + 1;
  }

  const daysByMonth = year % 4 === 0 ? leapYear : nonLeapYear;

  let month = 0;
  for (let i = 0; i < daysByMonth.length; i++) {
    const msInThisMonth = daysToMs(daysByMonth[i]);
    if (timestamp >= msInThisMonth) {
      timestamp = timestamp - msInThisMonth;
    } else {
      month = i + 1;
      break;
    }
  }

  const date = Math.floor(timestamp / daysToMs(1)) + 1;
  timestamp = timestamp - daysToMs(date - 1);
  const hours = Math.floor(timestamp / hoursToMs(1));
  timestamp = timestamp - hoursToMs(hours);
  const minutes = Math.floor(timestamp / minToMs(1));
  timestamp = timestamp - minToMs(minutes);
  const sec = Math.floor(timestamp / secToMs(1));
  timestamp = timestamp - secToMs(sec);

  return (
    year +
    '-' +
    padStart(month, 2) +
    '-' +
    padStart(date, 2) +
    'T' +
    padStart(hours, 2) +
    ':' +
    padStart(minutes, 2) +
    ':' +
    padStart(sec, 2) +
    'Z'
  );
}

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
  rawDataToLog.TraceId = getRequestHeader('trace-id');
  logToConsole(JSON.stringify(rawDataToLog));
}
