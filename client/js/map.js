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

geoapp.TileSets = {
    mapquest: {
        url: 'http://otile1.mqcdn.com/tiles/1.0.0/map/',
        credit: 'Tiles Courtesy of <a href="http://www.mapquest.com/">MapQuest</a>'
    },
    mqsat: {
        url: 'http://otile1.mqcdn.com/tiles/1.0.0/sat/',
        credit: 'Tiles Courtesy of <a href="http://www.mapquest.com/">MapQuest</a>'
    },
    openstreetmap: {
        url: 'http://tile.openstreetmap.org/',
        credit: '© OpenStreetMap contributors'
    },
    tonerlite: {
        url: 'http://tile.stamen.com/toner-lite/',
        credit: 'Map tiles by <a href="http://stamen.com">Stamen Design</a>, under <a href="http://creativecommons.org/licenses/by/3.0">CC BY 3.0</a>. Data by <a href="http://openstreetmap.org">OpenStreetMap</a>, under <a href="http://www.openstreetmap.org/copyright">ODbL</a>.'
    },
    blank: {url: 'api/v1/geoapp/tiles/blank/'}
};
geoapp.TileSets.default = geoapp.TileSets.mqsat;

geoapp.Map = function (arg) {
    'use strict';

    if (!(this instanceof geoapp.Map)) {
        return new geoapp.Map(arg);
    }
    arg = arg || {};

    var m_this = this,
        m_geoMap,
        m_mapLayer,

        m_layers = {},

        m_mapParams, /* parameters affecting the display */
        m_drawTimer, m_drawQueued,
        m_panTimer, m_panQueued, m_panIgnore,

        m_baseUrl,
        m_defaultCenter = {x: -73.978165, y: 40.757977},
        m_defaultGoodZone = 5, /* in degrees of latitude and longitude */
        m_goodExtents,
        m_defaultZoom = 10,

        m_cycleDateRange,
        m_animationOptions = {},
        m_animationData,
        m_animTimer,

        m_verbose = 0;

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
     * @param datakey: 'all' to update all known data layers, otherwise the
     *                 name of a data layer to update, or null to not update
     *                 any data layers.
     * @param data: the data to draw on the map (see above).
     * @param params: a set of parameters that affect the map but not what data
     *                was loaded.
     */
    this.showMap = function (datakey, data, params) {
        var view = this;
        data = data || [];
        var displayInfo = this.updateMapParams(datakey, params, false);

        if (!m_geoMap) {
            m_baseUrl = displayInfo.baseUrl;
            $('#ga-main-map').empty();
            m_geoMap = geo.map({
                node: '#ga-main-map',
                center: m_defaultCenter,
                zoom: m_defaultZoom
            });
            /* jscs:disable requireBlocksOnNewline */
            m_mapLayer = m_geoMap.createLayer('osm', {
                baseUrl: displayInfo.baseUrl,
                renderer: 'vgl',
                mapOpacity: displayInfo.opacity || 1
            })
            .geoOn(geo.event.pan, function (e) { view.mapMovedEvent(e); })
            .geoOn(geo.event.resize, function (e) { view.mapMovedEvent(e); })
            .geoOn(geo.event.zoom, function (e) { view.mapMovedEvent(e); });
            /* jscs:enable requireBlocksOnNewline */
            $('#ga-main-map').append('<div id="ga-map-credit-box">' +
                '<div id="ga-map-credit"/></div>');
            $('#ga-map-credit').html(displayInfo.baseUrlCredit || '');
        }
        if (datakey !== 'all') {
            this.ensureLayer(datakey);
            m_layers[datakey].data(data);
        }
        this.updateMapParams(datakey, params, 'always');
    };

    /* Check if a layer exists and create it if it doesn't.
     *
     * @param datakey: the layer to create or verify.
     */
    this.ensureLayer = function (datakey) {
        if (m_layers[datakey] === undefined && geoapp.mapLayers[datakey]) {
            m_layers[datakey] = geoapp.mapLayers[datakey](m_this);
        }
    };

    /* Perform any action necessary after a zoom or pan event.  This updates
     * the navigation route.
     *
     * Enter: evt: the event that triggered this action.  Null if from timer.
     *        always: if evt is null and this is true, process the current map
     *                position.
     */
    this.mapMovedEvent = function (evt, always) {
        if (m_panIgnore && (evt || !always)) {
            return;
        }
        if (evt && evt.eventType === geo.event.pan && (!evt.screenDelta || (
                !evt.screenDelta.x && !evt.screenDelta.y))) {
            return;
        }
        if (!evt) {
            if (m_panTimer) {
                window.clearTimeout(m_panTimer);
            }
            m_panTimer = null;
            if (!m_panQueued && !always) {
                return;
            }
        }
        if (!m_panTimer) {
            var view = this;
            var bounds = m_geoMap.bounds();
            var zoom = m_geoMap.zoom();
            geoapp.activityLog.logActivity('map_moved', 'map', {
                bounds: bounds,
                zoom: zoom
            });
            geoapp.updateNavigation(null, 'map', {
                x0: bounds.upperLeft.x.toFixed(7),
                y0: bounds.upperLeft.y.toFixed(7),
                x1: bounds.lowerRight.x.toFixed(7),
                y1: bounds.lowerRight.y.toFixed(7),
                zoom: zoom.toFixed(2)
            }, false, true);
            $('#ga-main-map').trigger('ga.map.moved');
            m_panQueued = false;
            m_panTimer = window.setTimeout(function () {
                view.mapMovedEvent();
            }, 250);
            return;
        } else {
            m_panQueued = true;
        }
    };

    /* Scale the map to include the specified bounds.  The bounds object can
     * contain either x0, y0, x1, y1 with the upper left and lower right
     * longitudes and latitudes, OR x, y, and zoom with the center longitude,
     * latitude, and zoom level, OR a default value will be used.
     *
     * @param bounds: an object as discussed above.
     * @param duration: duration in ms to transition to the location specified.
     *                  Defaults to 0.
     * @param sendMoveEvent: true to call mapMovedEvent(null, true) when the
     *                       transition is complete.
     */
    this.fitBounds = function (bounds, duration, sendMoveEvent) {
        bounds = bounds || {};
        var view = this;
        var curBounds = m_geoMap.bounds(),
            curZoom = m_geoMap.zoom();
        var params = {
            interp: d3.interpolateZoom,
            duration: parseInt(duration || 0),
            done: function () {
                m_panIgnore = false;
                if (sendMoveEvent) {
                    view.mapMovedEvent(null, true);
                }
            }
        };
        if (bounds.x0 !== undefined && bounds.y0 !== undefined &&
                bounds.x1 !== undefined && bounds.y1 !== undefined) {
            bounds.x0 = parseFloat(bounds.x0);
            bounds.y0 = parseFloat(bounds.y0);
            bounds.x1 = parseFloat(bounds.x1);
            bounds.y1 = parseFloat(bounds.y1);
            /* We want to view the entire rectangle that is specified, so
             * calculate the appropriate zoom. */
            params.center = {
                x: (bounds.x0 + bounds.x1) / 2,
                y: (bounds.y0 + bounds.y1) / 2
            };
            var scale = 1,
                scalex = Math.abs((bounds.x1 - bounds.x0) /
                    (curBounds.lowerRight.x - curBounds.upperLeft.x)),
                scaley = Math.abs((bounds.y1 - bounds.y0) /
                    (curBounds.lowerRight.y - curBounds.upperLeft.y));
            if (scalex && (!scaley || (scalex > scaley))) {
                scale = scalex;
            } else if (scaley) {
                scale = scaley;
            }
            params.zoom = curZoom - Math.log(scale) / Math.log(2);
        } else if (bounds.x !== undefined && bounds.y !== undefined && bounds.zoom !== undefined) {
            params.center = {x: parseFloat(bounds.x), y: parseFloat(bounds.y)};
            params.zoom = parseFloat(bounds.zoom);
        } else {
            params.center = m_defaultCenter;
            params.zoom = m_defaultZoom;
        }
        m_panIgnore = true;
        m_geoMap.transition(params);
    };

    /* Update parameters that affect how a map is displayed but not what data
     *  is used for the display.  Values that are updated include:
     *    display-tile-set: a short name for the map tile layer.
     *
     * @param datakey: 'all' to update all known data layers, otherwise the
     *                 name of a data layer to update, or null to not update
     *                 any data layers.
     * @param params: a dictionary of display values.  See above.
     * @param update: undefined or true to update an existing map if the
     *                parameters have changed.  false to not update.  'always'
     *                to update even if the parameters haven't changed.
     * @returns: a dictionary of internal information based on the parameters.
     */
    this.updateMapParams = function (datakey, params, update) {
        var startTime = new Date().getTime();
        params = params || {};
        params.opacity = params.opacity || 0.05;
        var origParams = m_mapParams || {};
        var results = {
            baseUrl: geoapp.TileSets['default'].url,
            baseUrlCredit: geoapp.TileSets['default'].credit,
            opacity: params['display-tile-opacity'] || 1
        };
        if (geoapp.TileSets[params['display-tile-set']] !== undefined) {
            results.baseUrl = geoapp.TileSets[params['display-tile-set']].url;
            results.baseUrlCredit = geoapp.TileSets[
                params['display-tile-set']].credit;
        } else if (params['display-tile-set'] &&
                params['display-tile-set'].substr(0, 4) === 'http') {
            results.baseUrl = params['display-tile-set'];
            results.baseUrlCredit = '';
        }
        m_mapParams = params;
        if (update === false ||
            (update !== 'always' && !_.isEqual(params, m_mapParams))) {
            return results;
        }
        if (results.baseUrl !== m_baseUrl) {
            m_mapLayer.updateBaseUrl(results.baseUrl);
            m_baseUrl = results.baseUrl;
            $('#ga-map-credit').html(results.baseUrlCredit || '');
        }
        m_mapLayer.mapOpacity(results.opacity);
        var animStartStep;
        var changed = false;
        _.each(m_layers, function (layer, layerkey) {
            if (datakey === 'all' || datakey === layerkey) {
                changed = changed || layer.paramsChanged(
                    params, origParams, update);
            }
        });
        if (changed) {
            /* clear animation preparation, but don't clear current step. */
            if (m_animationData && m_animationData.playState) {
                animStartStep = m_animationData.step;
            }
            if (m_animationData && m_animationData.playState &&
                    m_animationOptions && m_animationOptions.playState) {
                m_animationOptions.playState = m_animationData.playState;
            }
            m_animationData = null;
            _.each(m_layers, function (layer, layerkey) {
                if (datakey === 'all' || datakey === layerkey) {
                    layer.updateMapParams(params);
                }
            });
        }
        var loadTime = new Date().getTime();
        m_geoMap.draw();
        var drawTime = new Date().getTime();
        if (changed) {
            this.animate(undefined, animStartStep);
        }
        var animTime = new Date().getTime();
        if (m_verbose >= 1) {
            console.log(
                'updateMapParams load ' + (loadTime - startTime) + ' draw ' +
                (drawTime - loadTime) + ' anim ' + (animTime - drawTime) +
                ' total ' + (animTime - startTime));
        }
        return results;
    };

    /* Check if either end of this trip looks bogus.
     *
     * @param item: the trip to check.
     * @param data: an object that lists the pickup and dropoff columns in the
     *              attributes x1_column, y1_column, x2_column, y2_column.  If
     *              x2_column is undefined, only the pickup location is
     *              checked.
     * @returns: true if the point is bad.
     */
    this.isBadPoint = function (item, data) {
        var x1, y1, x2, y2;

        if (!m_goodExtents) {
            m_goodExtents = {
                x0: m_defaultCenter.x - m_defaultGoodZone,
                x1: m_defaultCenter.x + m_defaultGoodZone,
                y0: m_defaultCenter.y - m_defaultGoodZone,
                y1: m_defaultCenter.y + m_defaultGoodZone
            };
        }
        x1 = item[data.x1_column];
        y1 = item[data.y1_column];
        if (x1 < m_goodExtents.x0 || x1 > m_goodExtents.x1 ||
            y1 < m_goodExtents.y0 || y1 > m_goodExtents.y1) {
            return true;
        }
        if (data.x2_column) {
            x2 = item[data.x2_column];
            y2 = item[data.y2_column];
            if (x2 < m_goodExtents.xo || x2 > m_goodExtents.x1 ||
                y2 < m_goodExtents.y0 || y2 > m_goodExtents.y1) {
                return true;
            }
        }
        return false;
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
            var view = this;
            m_geoMap.draw();
            m_drawQueued = false;
            m_drawTimer = window.setTimeout(function () {
                view.triggerDraw(true);
            }, 33);
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
                m_animationData.playState !== (options.playState || 'play')) {
            m_animationData.playState = (options.playState || 'play');
            different = true;
        }
        if (different || !onlyUpdateOnChange) {
            this.animate();
        }
    };

    /* Check if there is any data associated with any layer.
     *
     * @returns: true if any data exists.
     */
    this.hasAnyData = function () {
        var anyData = false;
        _.each(m_layers, function (layer) {
            var data = layer.data();
            if (data && data.data && data.data.length) {
                anyData = true;
            }
        });
        return anyData;
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
        if (!this.hasAnyData() || options.playState === 'stop') {
            return;
        }
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
            if (m_cycleDateRange) {
                /* This will need to change if we use something other than
                 * pickup date */
                start = moment.utc('2013-01-01');
                end = moment.utc('2014-01-01');
                if (m_cycleDateRange.date_min) {
                    start = moment.utc(m_cycleDateRange.date_min);
                }
                if (m_cycleDateRange.date_max) {
                    end = moment.utc(m_cycleDateRange.date_max);
                }
            }
            if (!end) {
                var dateRange;
                _.each(m_layers, function (layer) {
                    if (layer.getDateRange && !end) {
                        dateRange = layer.getDateRange();
                        if (dateRange && dateRange.start && dateRange.end) {
                            start = dateRange.start;
                            end = dateRange.end;
                        }
                    }
                });
            }
            start = moment(start);
            range = moment.duration(moment(end) - moment(start) + 1);
        }
        var params = {
            numBins: numBins,
            steps: steps,
            substeps: substeps,
            bins: [],
            opacity: options.opacity,
            timestep: (options['cycle-steptime'] || 1000) / substeps,
            loops: options.loops,
            statusElem: options.statusElem,
            sliderElem: options.sliderElem,
            playState: options.playState || 'play',
            layers: {}
        };
        var binWidth = moment.duration(Math.floor(
            (range.asMilliseconds() + numBins - 1) / numBins));
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
        _.each(m_layers, function (layer) {
            if (layer.binForAnimation) {
                layer.binForAnimation(params, 0 + start, 0 + range,
                                      0 + binWidth);
            }
        });
        m_animationData = params;
    };

    /* Draw a frame of an animation.  If the current playState is 'play', set
     * a timer to play the next frame.
     */
    this.animateFrame = function () {
        var view = this,
            options = m_animationData;

        if (!options || !this.hasAnyData()) {
            return;
        }
        options.step = (options.step + 1) % options.numBins;
        options.renderedSteps = (options.renderedSteps || 0) + 1;
        _.each(m_layers, function (layer) {
            if (layer.animateFrame) {
                layer.animateFrame(options);
            }
        });
        m_geoMap.draw();
        var desc = this.getStepDescription(options.step);
        $(options.statusElem).text(desc);
        $(options.sliderElem).slider('enable').slider(
            'setAttribute', 'max', options.numBins - 1).slider(
            'setValue', options.step);
        var curTime = new Date().getTime();
        var frameTime = parseInt(curTime - options.nextStepTime);
        options.totalFrameTime = (options.totalFrameTime || 0) + frameTime;
        options.nextStepTime += options.timestep;
        var delay = parseInt(options.nextStepTime - curTime);
        if (m_verbose >= 2) {
            console.log([desc, delay, frameTime, options.step]);
        }
        while (delay < 0 && options.playState === 'play') {
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
        var curPlayState = null;

        if (action === 'jump' && m_animationData &&
                m_animationData.step === stepnum) {
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
        switch (action) {
            case 'jump':
                if (curPlayState !== 'stop') {
                    if (!m_animationData) {
                        this.animate(undefined, stepnum);
                    } else if (m_animationData.step !== stepnum) {
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
                    } else if (action === 'stepback') {
                        m_animationData.step = ((m_animationData.step +
                            m_animationData.numBins * 2 - 2) %
                            m_animationData.numBins);
                    }
                    m_animationData.nextStepTime = new Date().getTime();
                    this.animateFrame();
                }
                break;
            case 'stop':
                if (!this.hasAnyData()) {
                    return;
                }
                _.each(m_layers, function (layer) {
                    if (layer.animateStop) {
                        layer.animateStop();
                    }
                });
                m_geoMap.draw();
                if (m_animationData) {
                    $(m_animationData.sliderElem).slider('disable').slider(
                        'setValue', 0);
                }
                if (m_animationOptions) {
                    m_animationOptions.playState = 'stop';
                }
                break;
        }
        if (m_animationData) {
            var lastStep = ((m_animationData.step + m_animationData.numBins -
                             1) % m_animationData.numBins);
            if (m_animationData.playState === 'step' ||
                    m_animationData.playState === 'stepback') {
                m_animationData.playState = 'step' + lastStep;
            }
            if (m_animationData.playState !== curPlayState &&
                (!curPlayState || !m_animationData ||
                curPlayState.substr(0, 4) !== 'step' ||
                m_animationData.playState.substr(0, 4) !== 'step')) {
                geoapp.activityLog.logSystem('anim_action', 'map', {
                    action: action, stepnum: stepnum
                });
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
            geoMap: this.getMap(),
            mapLayer: m_mapLayer,
            layers: m_layers,
            mapParams: this.getMapParams(),
            cycleDateRange: m_cycleDateRange,
            animationOptions: m_animationOptions,
            animationData: m_animationData,
            verbose: m_verbose
        };
        if (m_animationData && m_animationData.renderedSteps) {
            var rate = {
                framesRendered: m_animationData.renderedSteps,
                framesSkipped: m_animationData.skippedSteps || 0,
                totalRenderTime: m_animationData.totalFrameTime,
                avgRenderTime: (m_animationData.totalFrameTime /
                                m_animationData.renderedSteps)
            };
            rate.framesTotal = rate.framesRendered + rate.framesSkipped;
            if (m_animationData.timestep) {
                rate.targetRate = Math.round(
                    1000000.0 / m_animationData.timestep) / 1000;
                rate.actualRate = (rate.targetRate * rate.framesRendered /
                                   rate.framesTotal);
                rate.maxRate = 1000.0 / (rate.avgRenderTime || 1);
            }
            state.animationRate = rate;
        }
        if (key) {
            return state[key];
        }
        return state;
    };

    /* Return the internal map parameters.
     *
     * @return: the map parameters.
     */
    this.getMapParams = function () {
        return m_mapParams;
    };

    /* Return the internal map.
     *
     * @return: the map.
     */
    this.getMap = function () {
        return m_geoMap;
    };

    /* Set the date range to use for the animation cycle if it is otherwise
     * unlimited.
     *
     * @param params: an object to extract the dates from.  May be null to
     *                clear the range.
     * @param minkey: the key to use within the object to get the minimum date
     *                in epoch milliseconds.  The key doesn't have to exist.
     * @param maxkey: the key to use within the object to get the maximum date
     *                in epoch milliseconds.  The key doesn't have to exist.
     */
    this.setCycleDateRange = function (params, minkey, maxkey) {
        if (params && params[minkey] !== params[maxkey]) {
            m_cycleDateRange = {
                date_min: params[minkey],
                date_max: params[maxkey]
            };
        } else {
            m_cycleDateRange = null;
        }
    };

    /* Get a layer by key.
     *
     * @param datakey: the layer's datakey.
     * @return: the layer if it exists, or null if it does not.
     */
    this.getLayer = function (datakey) {
        return m_layers[datakey];
    };
};
