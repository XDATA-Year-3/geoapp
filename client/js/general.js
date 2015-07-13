/* Copyright 2015 Kitware Inc.
 *
 *  Licensed under the Apache License, Version 2.0 ( the "License" );
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

/* General use functions that don't belong to a more specific code block. */

/* Check if the scroll is near the bottom of a scrollable element.  If so, call
 * to get more data.
 *
 * @param selector: a jquery selector for the scrollable element.  Its sole
 *                  child should be the scrollable data and have an outHeight
 *                  that is the size of the whole data.
 * @param loadFunc: the function to call to populate the scrollable child with
 *                  more data.  Returns truthy if more data is available, falsy
 *                  if all data is loaded.
 */
geoapp.infiniteScrollHandler = function (selector, loadFunc) {
    var liveZone = 300;

    var elem = $(selector),
        scrollTop = elem.scrollTop(),
        containerSize = elem.innerHeight(),
        dataSize = elem.children().outerHeight(true);
    if (scrollTop + containerSize + liveZone >= dataSize) {
        if (!loadFunc.call(this)) {
            elem.off('scroll.ga-infinite');
        }
    }
};

/* Attach a scroll handler to an element.  When its immediate children are
 * scrolled such that a small number of pixels are left near the bottom, a
 * callback function is called to attempt to load more data.  If the callback
 * returns false, no more data is expected.
 *
 * @param selector: a jquery selector for the scrollable element.  Its sole
 *                  child should be the scrollable data and have an outHeight
 *                  that is the size of the whole data.
 * @param loadFunc: the function to call to populate the scrollable child with
 *                  more data.  Returns truthy if more data is available, falsy
 *                  if all data is loaded.
 * @param context: context for the loadFunc.
 */
geoapp.infiniteScroll = function (selector, loadFunc, context) {
    var elem = $(selector);

    elem.off('scroll.ga-infinite');
    elem.on('scroll.ga-infinite', _.bind(
        geoapp.infiniteScrollHandler, context || this, selector, loadFunc));
};

/* Format latitude and longitude either as x.xxxxxx(deg)W, y.yyyyyy(deg)N or as
 * x(deg) x' x.xx"W, y(deg) y' y.yy"N.
 *
 * @param pos: the position.  This is an object with x and y in degrees.
 * @param useMinites: if true, use a minute and second format.
 * @returns: the formatted location.
 */
geoapp.formatLatLon = function (pos, useMinutes) {
    var result = '', lon = Math.abs(pos.x), lat = Math.abs(pos.y);

    if (useMinutes) {
        result += sprintf('%d\xB0 %d\' %4.2f"', Math.floor(lon),
            Math.floor(lon * 60) % 60, (lon * 60 - Math.floor(lon * 60)) * 60);
    } else {
        result += sprintf('%8.6f\xB0', lon);
    }
    result += (pos.x > 0 ? 'E' : (pos.x < 0 ? 'W' : '')) + ', ';
    if (useMinutes) {
        result += sprintf('%d\xB0 %d\' %4.2f"', Math.floor(lat),
            Math.floor(lat * 60) % 60, (lat * 60 - Math.floor(lat * 60)) * 60);
    } else {
        result += sprintf('%8.6f\xB0', lat);
    }
    result += (pos.y > 0 ? 'N' : (pos.y < 0 ? 'S' : ''));
    return result;
};

/* Make sure that a repaint has occured before calling a function.  I'm not
 * sure this is the best way, but it appears to always work.  See
 * http://stackoverflow.com/questions/22041757
 *
 * @param callback: the function to call after a repaint.
 */
geoapp.waitForRepaint = function (callback) {
    requestAnimationFrame(function () {
        requestAnimationFrame(callback);
    });
};

geoapp.ThrottledCallbacks = {};
/* Throttle calls to a function.  Instead of a callback, an action can be
 * specified:
 *   cancel - cancels any pending callbacks.
 *
 * @param name: the name of the callback timer.
 * @param callback: the callback to execute when appropriate.  null when this
 *                  is called after a timeout.  Alternately, a keyword to
 *                  perform some action; see above.
 * @param minDelay: minimum delay in milliseconds between calls.  If 0, push
 *                  back any pending request by the specified initDelay (which
 *                  must be positive).
 * @param initDelay: delay in milliseconds before first call if no calls are
 *                   outstanding.
 */
geoapp.throttleCallback = function (name, callback, minDelay, initDelay) {
    if (!geoapp.ThrottledCallbacks[name]) {
        geoapp.ThrottledCallbacks[name] = {};
    }
    if (!callback) {
        if (!geoapp.ThrottledCallbacks[name].call) {
            delete geoapp.ThrottledCallbacks[name];
            return;
        }
    } else if (callback === 'cancel') {
        if (geoapp.ThrottledCallbacks[name].timeout) {
            window.clearTimeout(geoapp.ThrottledCallbacks[name].timeout);
        }
        delete geoapp.ThrottledCallbacks[name];
        return;
    } else if (callback && geoapp.ThrottledCallbacks[name].timeout &&
            (!initDelay || minDelay !== 0)) {
        geoapp.ThrottledCallbacks[name].call = true;
        return;
    }
    if (geoapp.ThrottledCallbacks[name].timeout) {
        window.clearTimeout(geoapp.ThrottledCallbacks[name].timeout);
    }
    geoapp.ThrottledCallbacks[name].callback = (callback ||
        geoapp.ThrottledCallbacks[name].callback);
    geoapp.ThrottledCallbacks[name].delay = (minDelay ||
        geoapp.ThrottledCallbacks[name].delay || 0);
    if (initDelay) {
        geoapp.ThrottledCallbacks[name].call = true;
        geoapp.ThrottledCallbacks[name].timeout = window.setTimeout(
            function () {
                geoapp.throttleCallback(name);
            }, initDelay);
        return;
    }
    geoapp.ThrottledCallbacks[name].callback();
    geoapp.ThrottledCallbacks[name].call = false;
    if (geoapp.ThrottledCallbacks[name].delay) {
        geoapp.ThrottledCallbacks[name].timeout = window.setTimeout(
            function () {
                geoapp.throttleCallback(name);
            }, geoapp.ThrottledCallbacks[name].delay);
    } else {
        delete geoapp.ThrottledCallbacks[name];
    }
};

/* Get a valid random GUID.  See http://stackoverflow.com/questions/105034
 *
 * @returns: a random UUID that conforms to the official spec.
 */
geoapp.getRandomUUID = function () {
    var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
        /[xy]/g, function (c) {
            /* jshint bitwise: false */
            var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            /* jshint bitwise: true */
            return v.toString(16);
        });
    return uuid;
};
