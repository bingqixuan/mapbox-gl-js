// @flow

import window from './window';
import { extend } from './util';
import { isMapboxHTTPURL } from './mapbox';
import config from './config';
import assert from 'assert';

import type { Callback } from '../types/callback';
import type { Cancelable } from '../types/cancelable';

/**
 * The type of a resource.
 * @private
 * @readonly
 * @enum {string}
 */
const ResourceType = {
    Unknown: 'Unknown',
    Style: 'Style',
    Source: 'Source',
    Tile: 'Tile',
    Glyphs: 'Glyphs',
    SpriteImage: 'SpriteImage',
    SpriteJSON: 'SpriteJSON',
    Image: 'Image'
};
export { ResourceType };

if (typeof Object.freeze == 'function') {
    Object.freeze(ResourceType);
}

/**
 * A `RequestParameters` object to be returned from Map.options.transformRequest callbacks.
 * @typedef {Object} RequestParameters
 * @property {string} url The URL to be requested.
 * @property {Object} headers The headers to be sent with the request.
 * @property {string} credentials `'same-origin'|'include'` Use 'include' to send cookies with cross-origin requests.
 */
export type RequestParameters = {
    url: string,
    headers?: Object,
    method?: 'GET' | 'POST' | 'PUT',
    body?: string,
    type?: 'string' | 'json' | 'arrayBuffer',
    credentials?: 'same-origin' | 'include',
    collectResourceTiming?: boolean
};

export type ResponseCallback<T> = (error: ?Error, data: ?T, cacheControl: ?string, expires: ?string) => void;

class AJAXError extends Error {
    status: number;
    url: string;
    constructor(message: string, status: number, url: string) {
        if (status === 401 && isMapboxHTTPURL(url)) {
            message += ': you may have provided an invalid Mapbox access token. See https://www.mapbox.com/api-documentation/#access-tokens-and-token-scopes';
        }
        super(message);
        this.status = status;
        this.url = url;

        // work around for https://github.com/Rich-Harris/buble/issues/40
        this.name = this.constructor.name;
        this.message = message;
    }

    toString() {
        return `${this.name}: ${this.message} (${this.status}): ${this.url}`;
    }
}

function isWorker() {
    return typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' &&
           self instanceof WorkerGlobalScope;
}

// Ensure that we're sending the correct referrer from blob URL worker bundles.
// For files loaded from the local file system, `location.origin` will be set
// to the string(!) "null" (Firefox), or "file://" (Chrome, Safari, Edge, IE),
// and we will set an empty referrer. Otherwise, we're using the document's URL.
/* global self, WorkerGlobalScope */
export const getReferrer = isWorker() ?
    () => self.worker && self.worker.referrer :
    () => {
        const origin = window.location.origin;
        if (origin && origin !== 'null' && origin !== 'file://') {
            return origin + window.location.pathname;
        }
    };

function makeFetchRequest(requestParameters: RequestParameters, callback: ResponseCallback<any>): Cancelable {
    const controller = new window.AbortController();
    const request = new window.Request(requestParameters.url, {
        method: requestParameters.method || 'GET',
        body: requestParameters.body,
        credentials: requestParameters.credentials,
        headers: requestParameters.headers,
        referrer: getReferrer(),
        signal: controller.signal
    });

    if (requestParameters.type === 'json') {
        request.headers.set('Accept', 'application/json');
    }

    window.fetch(request).then(response => {
        if (response.ok) {
            response[requestParameters.type || 'text']().then(result => {
                callback(null, result, response.headers.get('Cache-Control'), response.headers.get('Expires'));
            }).catch(err => callback(new Error(err.message)));
        } else {
            callback(new AJAXError(response.statusText, response.status, requestParameters.url));
        }
    }).catch((error) => {
        if (error.code === 20) {
            // silence expected AbortError
            return;
        }
        callback(new Error(error.message));
    });

    return { cancel: () => controller.abort() };
}

function makeXMLHttpRequest(requestParameters: RequestParameters, callback: ResponseCallback<any>): Cancelable {
    const xhr: XMLHttpRequest = new window.XMLHttpRequest();

    xhr.open(requestParameters.method || 'GET', requestParameters.url, true);
    if (requestParameters.type === 'arrayBuffer') {
        xhr.responseType = 'arraybuffer';
    }
    for (const k in requestParameters.headers) {
        xhr.setRequestHeader(k, requestParameters.headers[k]);
    }
    if (requestParameters.type === 'json') {
        xhr.setRequestHeader('Accept', 'application/json');
    }
    xhr.withCredentials = requestParameters.credentials === 'include';
    xhr.onerror = () => {
        callback(new Error(xhr.statusText));
    };
    xhr.onload = () => {
        if (((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) && xhr.response !== null) {
            let data: mixed = xhr.response;
            if (requestParameters.type === 'json') {
                // We're manually parsing JSON here to get better error messages.
                try {
                    data = JSON.parse(xhr.response);
                } catch (err) {
                    return callback(err);
                }
            }
            callback(null, data, xhr.getResponseHeader('Cache-Control'), xhr.getResponseHeader('Expires'));
        } else {
            callback(new AJAXError(xhr.statusText, xhr.status, requestParameters.url));
        }
    };
    xhr.send(requestParameters.body);
    return { cancel: () => xhr.abort() };
}

export const makeRequest = function(requestParameters: RequestParameters, callback: ResponseCallback<any>): Cancelable {
    // We're trying to use the Fetch API if possible. However, in some situations we can't use it:
    // - IE11 doesn't support it at all. In this case, we dispatch the request to the main thread so
    //   that we can get an accruate referrer header.
    // - Requests for resources with the file:// URI scheme don't work with the Fetch API either. In
    //   this case we unconditionally use XHR on the current thread since referrers don't matter.
    if (!/^file:/.test(requestParameters.url)) {
        if (window.fetch && window.Request && window.AbortController) {
            return makeFetchRequest(requestParameters, callback);
        }
        if (isWorker() && self.worker && self.worker.actor) {
            return self.worker.actor.send('getResource', requestParameters, callback);
        }
    }
    return makeXMLHttpRequest(requestParameters, callback);
};

export const getJSON = function(requestParameters: RequestParameters, callback: ResponseCallback<Object>): Cancelable {
    return makeRequest(extend(requestParameters, { type: 'json' }), callback);
};

export const getArrayBuffer = function(requestParameters: RequestParameters, callback: ResponseCallback<ArrayBuffer>): Cancelable {
    return makeRequest(extend(requestParameters, { type: 'arrayBuffer' }), callback);
};

export const postData = function(requestParameters: RequestParameters, callback: ResponseCallback<string>): Cancelable {
    return makeRequest(extend(requestParameters, { method: 'POST' }), callback);
};

function sameOrigin(url) {
    const a: HTMLAnchorElement = window.document.createElement('a');
    a.href = url;
    return a.protocol === window.document.location.protocol && a.host === window.document.location.host;
}

//const transparentPngUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQYV2NgAAIAAAUAAarVyFEAAAAASUVORK5CYII=';
const transparentPngUrl = 'data:image/png;base64,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'

let imageQueue, numImageRequests;
export const resetImageRequestQueue = () => {
    imageQueue = [];
    numImageRequests = 0;
};
resetImageRequestQueue();

export const getImage = function(requestParameters: RequestParameters, callback: Callback<HTMLImageElement>): Cancelable {
    // limit concurrent image loads to help with raster sources performance on big screens
    if (numImageRequests >= config.MAX_PARALLEL_IMAGE_REQUESTS) {
        const queued = {
            requestParameters,
            callback,
            cancelled: false,
            cancel() { this.cancelled = true; }
        };
        imageQueue.push(queued);
        return queued;
    }
    numImageRequests++;

    let advanced = false;
    const advanceImageRequestQueue = () => {
        if (advanced) return;
        advanced = true;
        numImageRequests--;
        assert(numImageRequests >= 0);
        while (imageQueue.length && numImageRequests < config.MAX_PARALLEL_IMAGE_REQUESTS) { // eslint-disable-line
            const request = imageQueue.shift();
            const {requestParameters, callback, cancelled} = request;
            if (!cancelled) {
                request.cancel = getImage(requestParameters, callback).cancel;
            }
        }
    };

    // request the image with XHR to work around caching issues
    // see https://github.com/mapbox/mapbox-gl-js/issues/1470
    const request = getArrayBuffer(requestParameters, (err: ?Error, data: ?ArrayBuffer, cacheControl: ?string, expires: ?string) => {

        advanceImageRequestQueue();

        if (err) {
            callback(err);
        } else if (data) {
            const img: HTMLImageElement = new window.Image();
            const URL = window.URL || window.webkitURL;
            img.onload = () => {
                callback(null, img);
                URL.revokeObjectURL(img.src);
            };
            img.onerror = () => callback(new Error('Could not load image. Please make sure to use a supported image type such as PNG or JPEG. Note that SVGs are not supported.'));
            const blob: Blob = new window.Blob([new Uint8Array(data)], { type: 'image/png' });
            (img: any).cacheControl = cacheControl;
            (img: any).expires = expires;
            img.src = data.byteLength ? URL.createObjectURL(blob) : transparentPngUrl;
        }
    });

    return {
        cancel: () => {
            request.cancel();
            advanceImageRequestQueue();
        }
    };
};

export const getVideo = function(urls: Array<string>, callback: Callback<HTMLVideoElement>): Cancelable {
    const video: HTMLVideoElement = window.document.createElement('video');
    video.muted = true;
    video.onloadstart = function() {
        callback(null, video);
    };
    for (let i = 0; i < urls.length; i++) {
        const s: HTMLSourceElement = window.document.createElement('source');
        if (!sameOrigin(urls[i])) {
            video.crossOrigin = 'Anonymous';
        }
        s.src = urls[i];
        video.appendChild(s);
    }
    return { cancel: () => {} };
};
