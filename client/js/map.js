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

var geo_map, geo_layer, geo_feature, lastMapData = null;

/* Show a map with data.  If we have already shown the map, just update the
 * data and redraw the map.  The data is an object that contains:
 *   columns: a dictionary which has keys that reference the columns in the
 *      data array.
 *   data: an array of arrays with the relevant data.
 *   x_column: if present, use the 0-based column for the x coordinate.
 *      Otherwise, use columns.pickup_longitude.
 *   y_column: if present, use the 0-based column for the y coordinate.
 *      Otherwise, use columns.pickup_latitude.
 *
 * @param data: the data to draw on the map (see above).
 */
function showMap(data) {
    if (!geo_map) {
        geo_map = geo.map({
            node: '#ga-main-map',
            center: {
                x: -73.978165,
                y: 40.757977
            },
            zoom: 10
        });
        geo_map.createLayer('osm', {
            baseUrl: 'http://otile1.mqcdn.com/tiles/1.0.0/map/',
            //baseUrl: 'http://tile.openstreetmap.org/'
            zoomDelta: 3.5
        });
        geo_layer = geo_map.createLayer('feature', {
            renderer: 'vgl'
        });
        geo_feature = geo_layer.createFeature('point', {
            selectionAPI: false,
            dynamicDraw: true
        });
    }
    lastMapData = data;
    if (data && data.data) {
        if (!data.x_column) {
            data.x_column = data.columns.pickup_longitude;
        }
        if (!data.y_column) {
            data.y_column = data.columns.pickup_latitude;
        }
        geo_feature.data(data.data)
            .style({
                fillColor: 'black',
                fillOpacity: 0.05,
                stroke: false,
                radius: 5
            })
            .position(function (d) {
                return {
                    x: d[data.x_column],
                    y: d[data.y_column]
                };
            });
    }
    geo_map.draw();
}

/* Replace or add to the data used for the current map.  The options consist of
 *  params: a list of parameters to pass to the rest call.  If they are not
 *      set, the limit and fields keys in this dictionary are set
 *  maxcount: unset to auto-pick values, otherwise the maximum number of points
 *      to retrieve.
 *  data: the data that has been fetched.  This is extended as more data
 *      arrives.
 *  startTime: the epoch in ms when the first call to this function was made.
 *
 * @param: options: a dictionary with the parameters to use for fetching data
 *                  and the state of the process.  See above.
 */
function replaceMapData(options) {
    if (!options.maxcount) {
        options.verbose = (options.verbose === undefined ? true :
            options.verbose);
        if (options.verbose) {
            console.log(options);
        }
        options.maxcount = 250000;
        options.params.offset = 0;
        options.params.format = 'list';
        options.data = null;
        options.startTime = new Date().getTime();
        options.callNumber = 0;
        options.requestTime = options.showTime = 0;
    }
    if (!options.params.limit) {
        options.params.limit = Math.min(250000, options.maxcount);
    }
    if (!options.params.fields) {
        options.params.fields = 'medallion, hack_license, ' +
            'pickup_datetime, pickup_longitude, pickup_latitude, ' +
            'dropoff_datetime, dropoff_longitude, dropoff_latitude';
        if (options.params.random || options.params.random_min ||
                options.params.random_max) {
            options.params.sort = 'random';
        }
    }
    options.requestTime -= new Date().getTime();
    if (options.verbose) {
        console.log('request ' + (new Date().getTime() - options.startTime));
    }
    geoapp.cancelRestRequests('mapdata');
    var xhr = geoapp.restRequest({
        path: 'taxi', type: 'GET', data: options.params
    }).done(_.bind(function (resp) {
        if (!options.data) {
            options.data = resp;
        } else {
            $.merge(options.data.data, resp.data);
            options.data.datacount += resp.datacount;
        }
        options.requestTime += new Date().getTime();
        options.showTime -= new Date().getTime();
        if (options.verbose) {
            console.log('show ' + (new Date().getTime() - options.startTime));
        }
        showMap(options.data, options.callNumber);
        options.callNumber += 1;
        options.showTime += new Date().getTime();
        var callNext = ((options.data.datacount < options.data.count ||
            (resp.datacount == options.params.limit &&
            options.data.count === undefined)) &&
            options.data.datacount < options.maxcount);
        if (options.verbose) {
            console.log(
                (callNext ? 'next ' : 'last ') +
                (new Date().getTime() - options.startTime) + ' ' +
                options.data.datacount + ' ' + options.data.count +
                ' requestTime ' + options.requestTime + ' showTime ' +
                options.showTime);
        }
        if (callNext) {
            options.params.offset += resp.datacount;
            replaceMapData(options);
        }
    }, this));
    xhr.girder = {mapdata: true};
}

(function () {
    var drawTimer, drawQueued;

    /* Redraw the map, but not too often.  When we redraw the map, set a timer
     * so we don't do it again too soon.  If triggerDraw is called before the
     * timer expires, set a flag to redraw the map when the time is up.
     *
     * @param fromTimer: true if this called from the timer callback.
     */
    function triggerDraw(fromTimer) {
        if (fromTimer) {
            drawTimer = null;
            if (!drawQueued) {
                return;
            }
        }
        if (!drawTimer) {
            geo_map.draw();
            drawQueued = false;
            drawTimer = window.setTimeout(function () {
                triggerDraw(true);
            }, 100);
            return;
        } else {
            drawQueued = true;
        }
    }
})();

var animTimer = null;

function animateCallback(options) {
    if (!lastMapData || !lastMapData.data) {
        return;
    }
    if (!options.opac || options.opac.length != lastMapData.data.length * 6) {
        options.opac = new Float32Array(lastMapData.data.length * 6);
    }
    var chunk = (lastMapData.data.length + options.steps - 1) / options.steps;
    var startNum = chunk * 6 * options.step, endNum = startNum + chunk * 6;
    chunk *= 6;
    var visOpac = (options.opacity || 0.1);
    for (var i = 0; i < lastMapData.data.length * 6; i++) {
        var vis = (i >= startNum && i < endNum);
        options.opac[i] = (vis ? visOpac : 0);
    }
    geo_feature.actors()[0].mapper().updateSourceBuffer(
        'fillOpacity', options.opac);
    geo_map.draw();
    var delay;
    do {
        options.step = (options.step + 1) % options.steps;
        options.lastStepTime += options.timestep;
        delay = (options.lastStepTime + options.timestep -
                 new Date().getTime());
    } while (delay < -options.timestep);
    console.log([delay, options.timestep - delay, options.step]); //DWM::
    animTimer = window.setTimeout(function () {
        animateCallback(options);
    }, delay <= 0 ? 1 : delay);
}

function animate(options) {
    if (animTimer) {
        window.clearTimeout(animTimer);
        animTimer = null;
    }
    if (!options || !options.steps || options.steps <= 1) {
        return;
    }
    options = $.extend({}, options);
    options.step = 0;
    options.timestep = options.timestep || 1000;
    options.startTime = options.lastStepTime = new Date().getTime();
    console.log(options); //DWM::
    animTimer = window.setTimeout(function () {
        animateCallback(options);
    }, options.timestep);
}
