const computeEffectiveTldPlusOne = require('computeEffectiveTldPlusOne');
const createRegex = require('createRegex');
const getAllEventData = require('getAllEventData');
const getCookieValues = require('getCookieValues');
const getRequestHeader = require('getRequestHeader');
const getTimestampMillis = require('getTimestampMillis');
const getType = require('getType');
const JSON = require('JSON');
const logToConsole = require('logToConsole');
const makeInteger = require('makeInteger');
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

const PHONE_SEPARATORS_REGEX = createRegex('[\\s().-]', 'g');

// Fallback to V2, which is the one being used in the Gallery when this change was made.
const API_VERSION = data.type === 'trackOrder' ? 'v3' : data.apiVersion || 'v2';

let email = data.email;
if (data.storeEmail) {
  if (!email) email = getCookieValues('brevo_email')[0];
  else storeCookie('email', email);
}

const eventNameByType = {
  trackPage: 'page_view',
  trackEvent: data.event,
  trackLink: 'link',
  identify: 'identify',
  trackOrder: 'trackOrder'
};
if (!eventNameByType[data.type]) return data.gtmOnFailure();

sendEvent(eventNameByType[data.type], getEventPayload(data.type, eventNameByType[data.type]));

/*==============================================================================
  Vendor related functions
==============================================================================*/

function sendEvent(eventName, brevoEventData) {
  const missingFields = getMissingFields(brevoEventData);
  if (missingFields.length) {
    log({
      Name: 'Brevo',
      Type: 'Message',
      EventName: eventName,
      Message: '🛑 [ERROR] Request was not sent. API ' + API_VERSION,
      Reason: 'Missing or invalid required fields: ' + missingFields.join('; ')
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

function getEventPayload(type, eventName) {
  if (type === 'trackOrder') return getOrderPayload();

  const isV3 = API_VERSION === 'v3';
  const properties = getTableMap(data.properties);
  const payload = isV3
    ? { event_name: eventName, identifiers: getCustomerIdentifiers() }
    : { email: email };

  switch (type) {
    case 'trackPage':
      payload[isV3 ? 'event_properties' : 'properties'] = properties;
      payload.page = data.page;
      break;
    case 'trackEvent':
      payload[isV3 ? 'contact_properties' : 'properties'] = properties;
      payload[isV3 ? 'event_properties' : 'eventData'] = getTableMap(data.propertiesEvent);
      if (!isV3) payload.event = data.event;
      break;
    case 'trackLink':
      payload[isV3 ? 'event_properties' : 'properties'] = properties;
      payload.link = data.link;
      break;
    case 'identify':
      payload[isV3 ? 'contact_properties' : 'attributes'] = getTableMap(data.customerProperties);
      break;
  }

  return payload;
}

function getOrderPayload() {
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

function getCustomerIdentifiers() {
  return mergeObj({ email_id: email }, getTableMap(data.customerIdentifiers));
}

function getMissingFields(brevoEventData) {
  if (data.type === 'trackOrder') return getMissingOrderFields(brevoEventData);

  if (API_VERSION === 'v2') return isValidValue(brevoEventData.email) ? [] : ['Email'];

  const hasValidIdentifier = ['email_id', 'phone_id', 'ext_id'].some((p) =>
    isValidValue(brevoEventData.identifiers[p])
  );
  return hasValidIdentifier ? [] : ['Email, Phone Number or External ID (at least one)'];
}

function getMissingOrderFields(order) {
  const missingFields = [];
  if (!isValidValue(order.id)) missingFields.push('Order ID');
  if (!isValidValue(order.amount)) missingFields.push('Amount');
  if (!isValidValue(order.status)) missingFields.push('Status');
  if (!isValidUTCDate(order.createdAt))
    missingFields.push('Created At (UTC date-time in the format YYYY-MM-DDTHH:mm:ssZ)');
  if (!isValidUTCDate(order.updatedAt))
    missingFields.push('Updated At (UTC date-time in the format YYYY-MM-DDTHH:mm:ssZ)');
  return missingFields.concat(getInvalidOrderProductFields(order.products));
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
  const defaultExpirationDays = 730; // 2 years
  // makeInteger(undefined) returns 0, so a missing value (tags saved before this field existed)
  // must fall back to the default explicitly, otherwise the cookie would expire immediately.
  const expirationDays = isValidValue(data.cookieExpiration)
    ? makeInteger(data.cookieExpiration)
    : defaultExpirationDays;
  setCookie('brevo_' + name, value, {
    domain: getCookieDomain(data.cookieDomain),
    path: '/',
    samesite: data.cookieSameSite || 'Lax',
    secure: true,
    'max-age': 60 * 60 * 24 * (expirationDays >= 0 ? expirationDays : defaultExpirationDays),
    httpOnly: isUIFieldTrue(data.cookieHttpOnly)
  });
}

function getUserDataIdentifiers(data, eventData) {
  const tableIdentifiers = getTableMap(data.customerIdentifiers);
  const userData = eventData.user_data || {};
  const autoMap = data.autoMapEventData;
  // Priority: value set in the tag, then Event Data (automap), then the stored email cookie.
  const emailFromEventData = autoMap
    ? getFirstUnhashedValue([
        eventData.email,
        eventData.email_address,
        userData.email,
        userData.email_address
      ])
    : undefined;
  const phoneFromEventData = autoMap
    ? getFirstValidPhoneNumber([
        eventData.phone,
        eventData.phone_number,
        userData.phone_number,
        userData.phone
      ])
    : undefined;
  return {
    email_id: toStringIfValid(getFirstValidValue([data.email, emailFromEventData, email])),
    ext_id: toStringIfValid(
      getFirstValidValue([
        tableIdentifiers.ext_id,
        autoMap ? eventData.user_id : undefined,
        autoMap ? userData.user_id : undefined
      ])
    ),
    phone_id: toStringIfValid(getFirstValidValue([tableIdentifiers.phone_id, phoneFromEventData]))
  };
}

function getOrderProducts(data, eventData) {
  const rawProducts = data.products || (data.autoMapEventData ? getEventDataItems(eventData) : []);
  if (getType(rawProducts) !== 'array') return [];

  return rawProducts
    .filter((product) => getType(product) === 'object')
    .map((product) => {
      const quantity = makeNumber(getFirstValidValue([product.quantity, product.quantityFloat, 1]));
      return {
        productId: toStringIfValid(getFirstValidValue([product.productId, product.item_id])),
        variantId: toStringIfValid(
          getFirstValidValue([product.variantId, product.variant_id, product.item_variant])
        ),
        price: makeNumber(isValidValue(product.price) ? product.price : product.item_price),
        quantity: !isFloatNumber(quantity) ? quantity : undefined,
        quantityFloat: isFloatNumber(quantity) ? quantity : undefined
      };
    });
}

function getEventDataItems(eventData) {
  let items;
  if (getType(eventData.items) === 'array' && eventData.items.length) items = eventData.items;
  else if (
    getType(eventData.ecommerce) === 'object' &&
    getType(eventData.ecommerce.items) === 'array' &&
    eventData.ecommerce.items.length
  ) {
    items = eventData.ecommerce.items;
  }
  return items;
}

function getInvalidOrderProductFields(products) {
  if (getType(products) !== 'array' || products.length === 0) return ['Products'];

  const invalidFields = [];
  products.forEach((product, index) => {
    const productInvalidFields = [];
    if (!isValidValue(product.productId)) productInvalidFields.push('Product ID');
    if (!isValidValue(product.price)) productInvalidFields.push('Price');
    if (!isValidValue(product.quantity) && !isValidValue(product.quantityFloat))
      productInvalidFields.push('Quantity');
    if (productInvalidFields.length)
      invalidFields.push('Products[' + index + '] ' + productInvalidFields.join(', '));
  });
  return invalidFields;
}

function getOptionalOrderParams(data) {
  const properties = getTableMap(data.properties);
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
  const autoMap = data.autoMapEventData;
  const requiredParams = {
    id: toStringIfValid(
      getFirstValidValue([data.orderId, autoMap ? eventData.transaction_id : undefined])
    ),
    amount: makeNumber(getFirstValidValue([data.amount, autoMap ? eventData.value : undefined])),
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

function getFirstValidValue(values) {
  return values.filter(isValidValue)[0];
}

function toStringIfValid(value) {
  return isValidValue(value) ? makeString(value) : undefined;
}

function getFirstUnhashedValue(values) {
  return values.filter((value) => isValidValue(value) && !isHashed(value))[0];
}

function getFirstValidPhoneNumber(values) {
  return values.filter(isValidValue).map(normalizePhoneNumber).filter(isValidValue)[0];
}

function normalizePhoneNumber(phoneNumber) {
  phoneNumber = makeString(phoneNumber);
  if (PHONE_SEPARATORS_REGEX) phoneNumber = phoneNumber.replace(PHONE_SEPARATORS_REGEX, '');
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
  if (valueType === 'null' || valueType === 'undefined' || value !== value) return false;
  return value !== '' && value !== 'undefined' && value !== 'null';
}

function getTableMap(table) {
  return table ? makeTableMap(table, 'name', 'value') : {};
}

function getCookieDomain(cookieDomain) {
  return !cookieDomain || cookieDomain === 'auto'
    ? computeEffectiveTldPlusOne(eventData.page_location || getRequestHeader('referer')) || 'auto'
    : cookieDomain;
}

function isUIFieldTrue(field) {
  return [true, 'true'].indexOf(field) !== -1;
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
