/*
 * Copyright 2014-2021 Justin Pauli, all rights reserved.
 */
export enum HttpMethod {
    NONE = 'NONE',
    MULTI = 'MULTI',
    GET = 'GET',
    POST = 'POST',
    PUT = 'PUT',
    PATCH = 'PATCH',
    DELETE = 'DELETE',
    OPTIONS = 'OPTIONS',
}

export type HttpMethodName = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export const httpGetPost = [HttpMethod.GET, HttpMethod.POST]
export const httpRest = [
    HttpMethod.GET,
    HttpMethod.POST,
    HttpMethod.PUT,
    HttpMethod.PATCH,
    HttpMethod.DELETE,
]

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
export enum HttpCode {
    // Information responses
    CONTINUE = 100,
    SWITCHING_PROTOCOL = 101,
    PROCESSING = 102, // WebDAV
    EARLY_HINTS = 103,

    // Successful responses
    OK = 200,
    CREATED = 201,
    ACCEPTED = 202,
    NON_AUTHORITIVE_INFO = 203,
    NO_CONTENT = 204,
    RESET_CONTENT = 205,
    PARTIAL_CONTENT = 206,
    MULTI_STATUS = 207, // WebDAV
    ALREADY_REPORTED = 208, // WebDAV
    IM_USED = 226, // WebDAV

    // Redirection messages
    MULTIPLE_CHOICE = 300,
    MOVED_PERMANENTLY = 301,
    FOUND = 302,
    SEE_OTHER = 303,
    NOT_MODIFIED = 304,
    USE_PROXY = 305, // Deprecated
    TEMPORARILY_REDIRECTED = 307,
    PERMANENTLY_REDIRECTED = 308,

    // Client error responses
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    PAYMENT_REQUIRED = 402,
    FORBIDDEN = 403,
    NOT_FOUND = 404,
    METHOD_NOT_ALLOWED = 405,
    NOT_ACCEPTABLE = 406,
    PROXY_AUTH_REQUIRED = 407,
    REQUEST_TIMEOUT = 408,
    CONFLICT = 409,
    GONE = 410,
    LENGTH_REQUIRED = 411,
    PRECONDITION_FAILED = 412,
    PAYLOAD_TOO_LARGE = 413,
    URI_TOO_LONG = 414,
    UNSUPPORTED_MEDIA_TYPE = 415,
    RANGE_NOT_SATISFIABLE = 416,
    EXPECTATION_FAILED = 417,
    I_AM_A_TEAPOT = 418,
    UNPROCESSABLE_ENTITY = 422, // WebDAV
    LOCKED = 423, // WebDAV
    FAILED_DEPENDENCY = 424, // WebDAV
    TOO_EARLY = 425,
    UPGRADE_REQUIRED = 426,
    PRECONDITION_REQUIRED = 428,
    TOO_MANY_REQUESTS = 429,
    REQUEST_HEADER_FIELD_TOO_LARGE = 431,
    UNAVAILABLE_FOR_LEGAL_REASONS = 451,

    // Server error responses
    INTERNAL_SERVER_ERROR = 500,
    NOT_IMPLEMENTED = 501,
    BAD_GATEWAY = 502,
    SERVICE_UNAVAILABLE = 503,
    GATEWAY_TIMEOUT = 504,
    HTTP_VERSION_NOT_SUPPORTED = 505,
    VARIANT_ALSO_NEGOTIATES = 506,
    INSUFFICIENT_STORAGE = 507, // WebDAV
    LOOP_DETECTED = 508, // WebDAV
    NOT_EXTENDED = 510,
    NETWORK_AUTH_REQUIRED = 511,
}
