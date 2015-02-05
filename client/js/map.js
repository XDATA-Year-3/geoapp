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

geoapp.Map = function (arg) {
    'use strict';

    if (!(this instanceof geoapp.Map)) {
        return new geoapp.Map(arg);
    }
    arg = arg || {};

    var m_geoMap,
        m_geoPoints,
        m_lastMapData = null,
        m_drawTimer,
        m_drawQueued,
        m_animationOptions = {},
        m_animationData;

    /* Show a map with data.  If we have already shown the map, just update
     * the data and redraw the map.  The data is an object that contains:
     *   columns: a dictionary which has keys that reference the columns in
     *      the data array.
     *   data: an array of arrays with the relevant data.
     *   x_column: if present, use the 0-based column for the x coordinate.
     *      Otherwise, use columns.pickup_longitude.
     *   y_column: if present, use the 0-based column for the y coordinate.
     *      Otherwise, use columns.pickup_latitude.
     *
     * @param data: the data to draw on the map (see above).
     */
    this.showMap = function (data) {
        if (!m_geoMap) {
            m_geoMap = geo.map({
                node: '#ga-main-map',
                center: {
                    x: -73.978165,
                    y: 40.757977
                },
                zoom: 10
            });
            m_geoMap.createLayer('osm', {
                baseUrl: 'http://otile1.mqcdn.com/tiles/1.0.0/map/',
                //baseUrl: 'http://tile.openstreetmap.org/'
                zoomDelta: 3.5
            });
            var geoLayer = m_geoMap.createLayer('feature', {
                renderer: 'vgl'
            });
            m_geoPoints = geoLayer.createFeature('point', {
                selectionAPI: false,
                dynamicDraw: true
            });
        }
        m_lastMapData = data;
        if (data && data.data) {
            if (!data.x_column) {
                data.x_column = data.columns.pickup_longitude;
            }
            if (!data.y_column) {
                data.y_column = data.columns.pickup_latitude;
            }
            m_geoPoints.data(data.data)
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
        m_geoMap.draw();
    };

    /* Replace or add to the data used for the current map.  The options
     * consist of
     *  params: a list of parameters to pass to the rest call.  If they are
     *      not set, the limit and fields keys in this dictionary are set.
     *  maxcount: unset to auto-pick values, otherwise the maximum number of
     *      points to retrieve.
     *  data: the data that has been fetched.  This is extended as more data
     *      arrives.
     *  startTime: the epoch in ms when the first call to this function was
     *      made.
     *
     * @param: options: a dictionary with the parameters to use for fetching
     *                  data and the state of the process.  See above.
     */
    this.replaceMapData = function (options) {
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
            this.showMap(options.data, options.callNumber);
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
                this.replaceMapData(options);
            }
            //DWM:: update the animation, if appropriate
        }, this));
        xhr.girder = {mapdata: true};
    };

    /* Redraw the map, but not too often.  When we redraw the map, set a timer
     * so we don't do it again too soon.  If triggerDraw is called before the
     * timer expires, set a flag to redraw the map when the time is up.
     *
     * @param fromTimer: true if this called from the timer callback.
     */
    this.triggerDraw = function (fromTimer) {
        if (fromTimer) {
            m_drawTimer = null;
            if (!m_drawQueued) {
                return;
            }
        }
        if (!m_drawTimer) {
            m_geoMap.draw();
            m_drawQueued = false;
            m_drawTimer = window.setTimeout(function () {
                this.triggerDraw(true);
            }, 100);
            return;
        } else {
            m_drawQueued = true;
        }
    };

    /* Replace the current animation options with a new set.  If animating or
     * in a paused animation, update the animation.  The options consist of
     *  cycle: a duration, typically in a human-readable string, such as
     *      hour, day, week, month, year, or none.  This determines binning of
     *      the data.  That is, a cycle of a day means that multiple days of
     *      data are combined so that sub-day variations can be displayed.
     *  cycle-steps: the number of primary steps within the cycle.  This much
     *      data will be shown at once.  For instance, if the cycle is 'day',
     *      and the cycle-steps is 24, then 1 hour of data is shown at a time.
     *  cycle-substeps: the number of animation frames to use to progress
     *      through a step.  If this is 1, then only the steps are discrete.
     *      If greater than one, the steps overlap.  For instance with a cycle
     *      of 'day' and 24 steps, if the substeps are 12, then each animation
     *      step will add five minutes of data at one end of the range and
     *      remove five minutes of the data from the other end.
     *  cycle-steptime: milliseconds per step (not substep).
     *
     * @param options: animation options.  See above.
     */
    this.updateMapAnimation = function (options) {
        m_animationOptions = options;
        //DWM:: update the animation if appropriate. //DWM::
    };

    /* Calculate everything necessary to animate the map in an efficient
     * manner.
     *
     * @param options: if present, override the internal options set with
     *                 updateMapAnimation.
     */
    this.prepareAnimation = function (options) {
        var i;
        var units = {
            none: {format: 'MM-DD HH:mm'},
            year: {format: 'MM-DD HH:mm'},
            month: {format: 'DD HH:mm'},
            week: {format: 'ddd HH:mm', start: moment('2013-1-1').day(0)},
            day: {format: 'HH:mm'},
            hour: {format: 'mm:ss'}
        };
        options = options || m_animationOptions;
        m_animationData = null;
        var params = {};
        if (!m_lastMapData || !m_lastMapData.data ||
                !m_lastMapData.data.length) {
            return;
        }
        var data = m_lastMapData.data;
        var dateColumn = m_lastMapData.columns.pickup_datetime;
        var steps = parseInt(options['cycle-steps'] || 1);
        var substeps = parseInt(options['cycle-substeps'] || 1);
        var numBins = steps * substeps;
        if (steps <= 1 || numBins <= 1) {
            return;
        }
        var cycle = moment.normalizeUnits(options.cycle);
        if (!units[cycle]) {
            cycle = 'none';
        }
        var start = moment(units[cycle].start || '2013-01-01');
        var range = moment.duration(1, cycle);
        if (cycle === 'none') {
            // DWM:: if a date range was specified in the query for the same
            // dates that we are animating by, then use the query ranges.  If
            // not, use the full range
            start = data[0][dateColumn];
            var end = data[0][dateColumn];
            for (i = 1; i < data.length; i += 1) {
                if (data[i][dateColumn] < start) {
                    start = data[i][dateColumn];
                }
                if (data[i][dateColumn] > end) {
                    end = data[i][dateColumn];
                }
            }
            start = moment(start);
            range = moment.duration(moment(end) - moment(start) + 1);
        }
        params.bins = [];
        var binWidth = moment.duration(
            (range.asMilliseconds() + numBins - 1) / numBins);
        var binStart = start;
        for (i = 0; i < numBins; i += 1) {
            var binEnd = moment(binStart + binWidth);
            var bin = {
                index: i,
                start: binStart,
                end: binEnd,
                startDesc: binStart.format(units[cycle].format),
                endDesc: binEnd.format(units[cycle].format)
            };
            params.bins.push(bin);
            binStart = binEnd;
        }
        params.dataBin = new Int32Array(data.length);
        for (i = 0; i < data.length; i += 1) {
            params.dataBin[i] = parseInt(
                ((moment(data[i][dateColumn]) - start) % range) / binWidth);
        }
        m_animationData = params;
        debugVal = [params, m_lastMapData, start, range, binWidth]; //DWM::
    };

    /* -- DWM:: -- */
    var animTimer = null;

    this.animateCallback = function (options) {
        var view = this;
        if (!m_lastMapData || !m_lastMapData.data) {
            return;
        }
        var vpf = m_geoPoints.verticesPerFeature();
        if (!options.opac ||
                options.opac.length != m_lastMapData.data.length * vpf) {
            options.opac = new Float32Array(m_lastMapData.data.length * vpf);
        }
        var chunk = ((m_lastMapData.data.length + options.steps - 1) /
            options.steps);
        var startNum = chunk * vpf * options.step;
        var endNum = startNum + chunk * vpf;
        chunk *= vpf;
        var visOpac = (options.opacity || 0.1);
        for (var i = 0; i < m_lastMapData.data.length * vpf; i++) {
            var vis = (i >= startNum && i < endNum);
            options.opac[i] = (vis ? visOpac : 0);
        }
        m_geoPoints.actors()[0].mapper().updateSourceBuffer(
            'fillOpacity', options.opac);
        m_geoMap.draw();
        var delay;
        do {
            options.step = (options.step + 1) % options.steps;
            options.lastStepTime += options.timestep;
            delay = (options.lastStepTime + options.timestep -
                     new Date().getTime());
        } while (delay < -options.timestep);
        console.log([delay, options.timestep - delay, options.step]); //DWM::
        animTimer = window.setTimeout(function () {
            view.animateCallback(options);
        }, delay <= 0 ? 1 : delay);
    };

    this.animate = function (options) {
        var view = this;
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
            view.animateCallback(options);
        }, options.timestep);
    };
};
