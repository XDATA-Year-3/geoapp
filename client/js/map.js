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
        m_lastMapData,
        m_lastQueryOptions,
        m_drawTimer,
        m_drawQueued,
        m_animationOptions = {},
        m_animationData,
        m_animTimer,
        m_verbose = 1;

    this.maximumMapPoints = 300000;
    this.maximumDataPoints = null; /* defaults to maximumMapPoints */
    this.pageDataPoints = null;    /* defaults to maximumDataPoints */

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
            data.opacity = data.opacity || 0.05;
            if (!data.x_column) {
                data.x_column = data.columns.pickup_longitude;
            }
            if (!data.y_column) {
                data.y_column = data.columns.pickup_latitude;
            }
            m_geoPoints.data(data.data)
                .style({
                    fillColor: 'black',
                    fillOpacity: data.opacity,
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
            if (m_verbose >= 1) {
                console.log(options);
            }
            options.maxcount = this.maximumDataPoints || this.maximumMapPoints;
            options.params.offset = 0;
            options.params.format = 'list';
            options.data = null;
            options.startTime = new Date().getTime();
            options.callNumber = 0;
            options.requestTime = options.showTime = 0;
        }
        if (!options.params.limit) {
            options.params.limit = Math.min(
                this.pageDataPoints || options.maxcount, options.maxcount);
        }
        if (!options.params.fields) {
            options.params.fields = '' + //'medallion,hack_license,' +
                'pickup_datetime,pickup_longitude,pickup_latitude,' +
                ''; //'dropoff_datetime,dropoff_longitude, dropoff_latitude';
            if (options.params.random || options.params.random_min ||
                    options.params.random_max) {
                options.params.sort = 'random';
            }
        }
        options.requestTime -= new Date().getTime();
        if (m_verbose >= 1) {
            console.log('request ' + (new Date().getTime() - options.startTime));
        }
        geoapp.cancelRestRequests('mapdata');
        var xhr = geoapp.restRequest({
            path: 'taxi', type: 'GET', data: options.params
        }).done(_.bind(function (resp) {
            /* clear animation preparation, but don't clear current step. */
            var animStartStep;
            if (m_animationData && m_animationData.playState &&
                    m_animationData.playState.substr(0, 4) !== 'step') {
                animStartStep = m_animationData.step;
            }
            m_animationData = null;
            if (!options.data) {
                options.data = resp;
            } else {
                $.merge(options.data.data, resp.data);
                options.data.datacount += resp.datacount;
            }
            options.requestTime += new Date().getTime();
            options.showTime -= new Date().getTime();
            if (m_verbose >= 1) {
                console.log('show ' + (new Date().getTime() - options.startTime));
            }
            m_lastQueryOptions = $.extend({}, options, {data: null});
            this.showMap(options.data, options.callNumber);
            options.callNumber += 1;
            options.showTime += new Date().getTime();
            var callNext = ((options.data.datacount < options.data.count ||
                (resp.datacount == options.params.limit &&
                options.data.count === undefined)) &&
                options.data.datacount < options.maxcount);
            if (m_verbose >= 1) {
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
            this.animate(undefined, animStartStep);
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
     * @param onlyUpdateOnChange: if true, only update if the options have
     *                            changed.
     */
    this.updateMapAnimation = function (options, onlyUpdateOnChange) {
        var different = !_.isEqual(m_animationOptions, options);
        m_animationOptions = options;
        if (different) {
            m_animationData = null;
        }
        if (m_animationData &&
                m_animationData.playState != (options.playState || 'play')) {
            m_animationData.playState = (options.playState || 'play');
            different = true;
        }
        if (different || !onlyUpdateOnChange) {
            this.animate();
        }
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
            none: {format: 'ddd MM-DD HH:mm'},
            year: {format: 'ddd MM-DD HH:mm'},
            month: {format: 'DD HH:mm'},
            week: {format: 'ddd HH:mm', start: moment.utc('2013-1-1').day(0)},
            day: {format: 'HH:mm'},
            hour: {format: 'mm:ss'}
        };
        options = options || m_animationOptions;
        m_animationOptions = options;
        m_animationData = null;
        if (!m_lastMapData || !m_lastMapData.data ||
                !m_lastMapData.data.length || options.playState === 'stop') {
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
        var start = units[cycle].start || moment.utc('2013-01-01');
        var range = moment.duration(1, cycle);
        if (cycle === 'none') {
            var end = null;
            if (m_lastQueryOptions && m_lastQueryOptions.params) {
                /* This will need to change if we use something other than
                 * pickup date */
                var query = m_lastQueryOptions.params;
                start = moment.utc('2013-01-01');
                end = moment.utc('2014-01-01');
                if (query.pickup_datetime_min) {
                    start = moment.utc(query.pickup_datetime_min);
                }
                if (query.pickup_datetime_max) {
                    end = moment.utc(query.pickup_datetime_max);
                }
            }
            if (!end) {
                start = data[0][dateColumn];
                end = data[0][dateColumn];
                for (i = 1; i < data.length; i += 1) {
                    if (data[i][dateColumn] < start) {
                        start = data[i][dateColumn];
                    }
                    if (data[i][dateColumn] > end) {
                        end = data[i][dateColumn];
                    }
                }
            }
            start = moment(start);
            range = moment.duration(moment(end) - moment(start) + 1);
        }
        var params = {
            numBins: numBins,
            steps: steps,
            substeps: substeps,
            bins: [],
            dataBin: new Int32Array(data.length),
            opacity: options.opacity,
            timestep: (options['cycle-steptime'] || 1000) / substeps,
            loops: options.loops,
            statusElem: options.statusElem,
            sliderElem: options.sliderElem,
            playState: options.playState || 'play'
        };
        var binWidth = moment.duration(
            (range.asMilliseconds() + numBins - 1) / numBins);
        var binStart = start;
        for (i = 0; i < numBins; i += 1) {
            var binEnd = moment(binStart + binWidth);
            var bin = {
                index: i,
                start: binStart,
                end: binEnd,
                startDesc: binStart.utcOffset(0).format(units[cycle].format),
                endDesc: binEnd.utcOffset(0).format(units[cycle].format)
            };
            params.bins.push(bin);
            binStart = binEnd;
        }
        for (i = 0; i < data.length; i += 1) {
            params.dataBin[i] = parseInt(
                ((moment(data[i][dateColumn]) - start) % range) / binWidth);
        }
        m_animationData = params;
    };

    /* Draw a frame of an animation.  If the current playState is 'play', set
     * a timer to play the next frame.
     */
    this.animateFrame = function () {
        var view = this;
        if (!m_lastMapData || !m_lastMapData.data || !m_animationData) {
            return;
        }
        var options = m_animationData;
        options.step = (options.step + 1) % options.numBins;
        options.renderedSteps = (options.renderedSteps || 0) + 1;
        var vpf = m_geoPoints.verticesPerFeature();
        if (!options.opac ||
                options.opac.length != m_lastMapData.data.length * vpf) {
            options.opac = new Float32Array(m_lastMapData.data.length * vpf);
        }
        var visOpac = (options.opacity || 0.1);
        for (var i = 0, v = 0, j; i < m_lastMapData.data.length; i += 1) {
            var bin = options.dataBin[i];
            var vis = ((bin >= options.step &&
                bin < options.step + options.substeps) ||
                bin + options.numBins < options.step + options.substeps);
            for (j = 0; j < vpf; j += 1, v += 1) {
                options.opac[v] = (vis ? visOpac : 0);
            }
        }
        m_geoPoints.actors()[0].mapper().updateSourceBuffer(
            'fillOpacity', options.opac);
        m_geoMap.draw();
        var desc = this.getStepDescription(options.step);
        $(options.statusElem).text(desc);
        $(options.sliderElem).slider('enable').slider(
            'setAttribute', 'max', options.numBins - 1).slider(
            'setValue', options.step);
        var curTime = new Date().getTime();
        var frameTime = parseInt(curTime - options.nextStepTime);
        options.nextStepTime += options.timestep;
        var delay = parseInt(options.nextStepTime - curTime);
        if (m_verbose >= 2) {
            console.log([desc, delay, frameTime, options.step]);
        }
        while (delay < 0) {
            /* We have to skip some frames */
            options.step = (options.step + 1) % options.numBins;
            options.nextStepTime += options.timestep;
            delay = parseInt(options.nextStepTime - curTime);
            options.skippedSteps = (options.skippedSteps || 0) + 1;
        }
        if (options.loops && options.renderedSteps >= options.loops *
                options.numBins || options.playState !== 'play') {
            return;
        }
        m_animTimer = window.setTimeout(
            function () {
                view.animateFrame();
            }, delay <= 0 ? 1 : delay);
    };

    /* Start an animation.  See updateMapAnimation for option details.
     *
     * @param options: a dictionary of options.  If unset, use the last
     *                 options passed to updateMapAnimation.
     * @param startStep: step to start on within the animation.
     */
    this.animate = function (options, startStep) {
        var view = this;
        if (m_animTimer) {
            window.clearTimeout(m_animTimer);
            m_animTimer = null;
        }
        if (options || !m_animationData) {
            this.prepareAnimation(options);
        }
        if (!m_animationData) {
            return;
        }
        if (startStep === undefined && m_animationData.playState &&
                m_animationData.playState.substr(0, 4) === 'step') {
            startStep = parseInt(m_animationData.playState.substr(4));
        }
        m_animationData.step = (((startStep || 0) +
            m_animationData.numBins - 1) % m_animationData.numBins);
        m_animationData.timestep = m_animationData.timestep || 1000;
        m_animationData.startTime = m_animationData.nextStepTime =
            new Date().getTime();
        this.animateFrame();
    };

    /* Stop, play, pause, or step the current animation.  Stop returns the
     * display to before animation was started.
     *
     * @param action: one of 'stop', 'play', 'pause', 'step', 'stepback', or
     *                'jump'.
     * @param stepnum: if the action is 'jump', switch to this step number and
     *                 maintain the current play state.
     */
    this.animationAction = function (action, stepnum) {
        var curPlayState = null, startStep;

        if (action === 'jump' && m_animationData &&
                m_animationData.step == stepnum) {
            return;
        }
        if (m_animTimer) {
            window.clearTimeout(m_animTimer);
            m_animTimer = null;
        }
        if (m_animationData) {
            curPlayState = m_animationData.playState;
            if (action === curPlayState) {
                return;
            }
            if (action !== 'jump') {
                m_animationData.playState = action;
            }
        }
        if (!m_lastMapData || !m_lastMapData.data) {
            return;
        }
        switch (action) {
            case 'jump':
                if (curPlayState !== 'stop') {
                    if (!m_animationData) {
                        this.animate(undefined, stepnum);
                    } else if (m_animationData.step != stepnum) {
                        m_animationData.step = ((stepnum +
                            m_animationData.numBins - 1) %
                            m_animationData.numBins);
                        m_animationData.nextStepTime = new Date().getTime();
                        this.animateFrame();
                    }
                }
                break;
            case 'pause': case 'play': case 'step': case 'stepback':
                if (!m_animationData) {
                    if (m_animationOptions &&
                            m_animationOptions.playState === 'stop') {
                        m_animationOptions.playState = (
                            action === 'play' ? action : 'pause');
                    }
                    this.animate();
                } else {
                    if (curPlayState === 'stop') {
                        m_animationData.step = -1;
                    } else if (action == 'stepback') {
                        m_animationData.step = ((m_animationData.step +
                            m_animationData.numBins * 2 - 2) %
                            m_animationData.numBins);
                    }
                    m_animationData.nextStepTime = new Date().getTime();
                    this.animateFrame();
                }
                break;
            case 'stop':
                var vpf = m_geoPoints.verticesPerFeature();
                var opac = new Float32Array(m_lastMapData.data.length * vpf);
                for (var v = 0; v < m_lastMapData.data.length * vpf; v += 1) {
                    opac[v] = m_lastMapData.opacity;
                }
                m_geoPoints.actors()[0].mapper().updateSourceBuffer(
                    'fillOpacity', opac);
                m_geoMap.draw();
                $(m_animationData.sliderElem).slider('disable').slider(
                    'setValue', 0);
                break;
        }
        if (m_animationData) {
            var lastStep = ((m_animationData.step + m_animationData.numBins -
                             1) % m_animationData.numBins);
            if (m_animationData.playState === 'step' ||
                    m_animationData.playState === 'stepback') {
                m_animationData.playState = 'step' + lastStep;
            }
            return lastStep;
        }
    };

    /* Return the description of the current step of an animation.
     *
     * @param step: 0-based step.  If undefined, then use the current step.
     * @returns: description for the specified step.  If the animation is
     *           stopped, then the description is 'Stopped'.
     */
    this.getStepDescription = function (step) {
        if (!m_animationData || m_animationData.playState === 'stop') {
            return 'Stopped';
        }
        if (step === undefined) {
            step = m_animationData.step;
        }
        step = step % m_animationData.numBins;
        var desc = m_animationData.bins[step].startDesc + ' - ' +
            m_animationData.bins[(step + m_animationData.substeps - 1) %
            m_animationData.numBins].endDesc;
        return desc;
    };

    /* Set or get the current verbosity for console logging.
     *
     * @param verbose: if specified, set the verbosity to this integer.
     * @returns: the current verbosity.
     */
    this.verbosity = function (verbose) {
        if (verbose !== undefined) {
            m_verbose = parseInt(verbose);
        }
        return m_verbose;
    };

    /* Return the current internal state of the map.
     *
     * @param key: the key of the object to fetch, or undefined for a
     *             dictionary of objects.
     * @returns: a dictionary of the current state, or one of the internal
     *           state objects.
     */
    this.getInternalState = function (key) {
        var state = {
            geoMap: m_geoMap,
            geoPoints: m_geoPoints,
            lastMapData: m_lastMapData,
            lastQueryOptions: m_lastQueryOptions,
            animationOptions: m_animationOptions,
            animationData: m_animationData,
            verbose: m_verbose
        };
        if (key) {
            return state[key];
        }
        return state;
    };
};
