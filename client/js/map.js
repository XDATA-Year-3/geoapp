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
    blank: {url: 'api/v1/taxi/tiles/blank/'}
};
geoapp.TileSets.default = geoapp.TileSets.mqsat;

geoapp.Map = function (arg) {
    'use strict';

    if (!(this instanceof geoapp.Map)) {
        return new geoapp.Map(arg);
    }
    arg = arg || {};

    var m_geoMap,
        m_mapLayer,
        m_geoPoints, m_geoLines, m_geoPoly,
        m_mapData,
        m_mapParams,
        m_lastQueryOptions,
        m_drawTimer, m_drawQueued,
        m_panTimer, m_panQueued, m_panIgnore,
        m_animationOptions = {},
        m_animationData,
        m_animTimer,
        m_baseUrl, m_baseUrlCredit,
        m_pickupOnlyColor = geo.util.convertColor('black'),
        m_pickupColor = geo.util.convertColor('#0000FF'),
        m_dropoffOnlyColor = geo.util.convertColor('black'),
        m_dropoffColor = geo.util.convertColor('#FFFF00'),
        m_defaultCenter = {x: -73.978165, y: 40.757977},
        m_defaultGoodZone = 5, /* in degrees of latitude and longitude */
        m_goodExtents,
        m_defaultZoom = 10,
        m_maxVectorScale = 5, /* Increase vector sizes */
        m_verbose = 1;

    this.maximumMapPoints = 100000;
    this.maximumVectors = 50000;
    /* maximumDataPoints defaults to the maximum of maximumMapPoints and
     * maximumVectors */
    this.maximumDataPoints = null;
    /* pageDataPoints to null to load everything in one batch (to use
     * maximumDataPoints).  If oneSmallPage is true, pageDataPoints are loaded,
     * then all of the rest of the data in a second query.  If false,
     * pageDataPoints are loaded at a time until all of the data is loaded. */
    this.pageDataPoints = 10000;
    this.oneSmallPage = true;

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
     * @param params: a set of parameters that affect the map but not what data
     *                was loaded.
     */
    this.showMap = function (data, params) {
        var view = this;
        data = data || [];
        var displayInfo = this.updateMapParams(params, false);

        if (!m_geoMap) {
            var geoLayer;
            m_baseUrl = displayInfo.baseUrl;
            $('#ga-main-map').empty();
            m_geoMap = geo.map({
                node: '#ga-main-map',
                center: m_defaultCenter,
                zoom: m_defaultZoom
            });
            m_mapLayer = m_geoMap.createLayer('osm', {
                baseUrl: displayInfo.baseUrl,
                renderer: 'vgl',
                mapOpacity: displayInfo.opacity || 1
            })
            .geoOn(geo.event.pan, function (e) { view.mapMovedEvent(e); })
            .geoOn(geo.event.resize, function (e) { view.mapMovedEvent(e); })
            .geoOn(geo.event.zoom, function (e) { view.mapMovedEvent(e); });
            geoLayer = m_geoMap.createLayer('feature', {
                renderer: 'vgl'
            });
            m_geoPoints = geoLayer.createFeature('point', {
                primitiveShape: 'sprite',
                selectionAPI: false,
                dynamicDraw: true
            });
            geoLayer = m_geoMap.createLayer('feature', {
                renderer: 'vgl'
            });
            m_geoPoly = geoLayer.createFeature('polygon', {
                selectionAPI: false,
                dynamicDraw: true
            });
            geoLayer = m_geoMap.createLayer('feature', {
                renderer: 'vgl'
            });
            m_geoLines = geoLayer.createFeature('line', {
                selectionAPI: false,
                dynamicDraw: true
            });
            $('#ga-main-map').append('<div id="ga-map-credit-box">' +
                '<div id="ga-map-credit"/></div>');
            $('#ga-map-credit').html(displayInfo.baseUrlCredit || '');
        }
        m_mapData = data;
        this.updateMapParams(params, 'always');
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
            geoapp.activityLog.logActivity('map_moved', {
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
        var node = m_geoMap.node(),
            width = node.width(), height = node.height(),
            curBounds = m_geoMap.bounds(),
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
     *  display: a list of parameters that affect the display but not the
     *      selected data.
     *
     * @param: options: a dictionary with the parameters to use for fetching
     *                  data and the state of the process.  See above.
     */
    this.replaceMapData = function (options) {
        if (!options.maxcount) {
            if (m_verbose >= 1) {
                console.log(options);
            }
            options.maxcount = this.maximumDataPoints || Math.max(
                this.maximumMapPoints, this.maximumVectors);
            options.params.offset = 0;
            options.params.format = 'list';
            options.data = null;
            options.startTime = new Date().getTime();
            options.callNumber = 0;
            options.requestTime = options.showTime = 0;
            options.origMapParams = m_mapParams;
        }
        if (!options.params.limit) {
            options.params.limit = Math.min(
                this.pageDataPoints || options.maxcount, options.maxcount);
        } else if (this.oneSmallPage) {
            options.params.limit = options.maxcount - options.params.offset;
        }
        if (!options.params.fields) {
            options.params.fields = '' + //'medallion,hack_license,' +
                'pickup_datetime,pickup_longitude,pickup_latitude,' +
                'dropoff_datetime,dropoff_longitude,dropoff_latitude';
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
        $('#ga-map-loading').removeClass('hidden')
            .toggleClass('first-load', !options.params.offset)
            .toggleClass('second-load', !!options.params.offset);
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
            if (m_verbose >= 1) {
                console.log('show ' + (new Date().getTime() - options.startTime));
            }
            m_lastQueryOptions = $.extend({}, options, {data: null});
            if (!_.isEqual(m_mapParams, options.origMapParams)) {
                options.display = m_mapParams;
            }
            this.showMap(options.data, options.display);
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
            } else {
                $('#ga-map-loading').addClass('hidden');
            }
            geoapp.activityLog.logActivity('load_data', {complete: !callNext});
        }, this));
        xhr.girder = {mapdata: true};
    };

    /* Update parameters that affect how a map is displayed but not what data
     *  is used for the display.  Values that are updated include:
     *    display-tile-set: a short name for the map tile layer.
     *    display-type: 'pickup', 'dropoff', 'both', or 'vector'.
     *    display-process: 'raw' or 'binned'.
     *    opacity: the opacity used for non-animated points and lines.
     *
     * @param params: a dictionary of display values.  See above.
     * @param update: undefined or true to update an existing map if the
     *                parameters have changed.  false to not update.  'always'
     *                to update even if the parameters haven't changed.
     * @returns: a dictionary of internal information based on the parameters.
     */
    this.updateMapParams = function (params, update) {
        var startTime = new Date().getTime();
        params = params || (m_lastQueryOptions ? m_lastQueryOptions.display ||
                            {} : {});
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
        if (results.baseUrl != m_baseUrl) {
            m_mapLayer.updateBaseUrl(results.baseUrl);
            m_baseUrl = results.baseUrl;
            $('#ga-map-credit').html(results.baseUrlCredit || '');
        }
        m_mapLayer.mapOpacity(results.opacity);
        var animStartStep;
        var data = m_mapData;
        var changed = (data && data.data && update === 'always');
        if (data && data.data) {
            /* display-tile-set and display-tile-opacity are intentionally not
             * included here, is they don't affect the animation. */
            ['display-type', 'display-process', 'display-num-bins'].forEach(function (key) {
                changed = changed || (params[key] !== origParams[key]);
            });
        }
        if (changed) {
            /* clear animation preparation, but don't clear current step. */
            if (m_animationData && m_animationData.playState &&
                    m_animationData.playState.substr(0, 4) !== 'step') {
                animStartStep = m_animationData.step;
            }
            m_animationData = null;
            switch (params['display-process']) {
                case 'binned':
                    this.binMapData(params);
                    this.setMapDisplayToBinnedData(params);
                    break;
                default:
                    switch (params['display-type']) {
                        case 'both':
                            this.setMapDisplayToBothPoints();
                            break;
                        case 'dropoff':
                            this.setMapDisplayToPoints(params['display-type']);
                            break;
                        case 'vector':
                            this.setMapDisplayToVectors();
                            break;
                        default:
                            this.setMapDisplayToPoints('pickup');
                            break;
                    }
                    break;
            }
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

    /* Set the map to display pickup or dropoff points.
     *
     * @param displayType: either 'pickup' or 'dropoff'
     */
    this.setMapDisplayToPoints = function (displayType) {
        var data = m_mapData, params = m_mapParams;

        data.numPoints = Math.min(data.data.length, this.maximumMapPoints);
        data.numLines = 0;
        m_geoLines.data([]);
        data.numPolygons = 0;
        m_geoPoly.data([]);
        if (displayType === 'dropoff') {
            data.x_column = data.columns.dropoff_longitude;
            data.y_column = data.columns.dropoff_latitude;
        } else {
            data.x_column = data.columns.pickup_longitude;
            data.y_column = data.columns.pickup_latitude;
        }
        var pointData = data.data || [];
        if (pointData.length > this.maximumMapPoints) {
            pointData = data.data.slice(0, this.maximumMapPoints);
        }
        m_geoPoints.data(pointData)
        .style({
            fillColor: (displayType === 'dropoff' ?  m_dropoffOnlyColor :
                m_pickupOnlyColor),
            fillOpacity: params.opacity,
            stroke: false,
            radius: 5
        })
        .position(function (d) {
            return {
                x: d[data.x_column],
                y: d[data.y_column]
            };
        });
    };

    /* Check if either end of this trip looks bogus.
     *
     * @param item: the trip to check.
     * @param data: an object that lists the pickup and dropoff columns in the
     *              attributes x1_column, y1_column, x2_column, y2_column.
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
        x2 = item[data.x2_column];
        y2 = item[data.y2_column];
        if (x2 < m_goodExtents.xo || x2 > m_goodExtents.x1 ||
            y2 < m_goodExtents.y0 || y2 > m_goodExtents.y1) {
            return true;
        }
        return false;
    };

    /* Set the map to display pickup to dropoff vectors.
     */
    this.setMapDisplayToVectors = function () {
        var data = m_mapData, params = m_mapParams, item;

        data.numPoints = 0;
        m_geoPoints.data([]);
        data.numPolygons = 0;
        m_geoPoly.data([]);
        data.numLines = Math.min(data.data.length, this.maximumVectors);
        data.x1_column = data.columns.pickup_longitude;
        data.y1_column = data.columns.pickup_latitude;
        data.x2_column = data.columns.dropoff_longitude;
        data.y2_column = data.columns.dropoff_latitude;
        for (var i = 0; i < data.data.length; i += 1) {
            item = data.data[i];
            if (this.isBadPoint(item, data)) {
                item.hide = true;
            }
        }
        var lineRecord = [{
            x_column: data.x1_column,
            y_column: data.y1_column,
            strokeColor: m_pickupColor
        }, {
            x_column: data.x2_column,
            y_column: data.y2_column,
            strokeColor: m_dropoffColor
        }];
        var lineData = data.data;
        if (lineData.length > this.maximumVectors) {
            lineData = data.data.slice(0, this.maximumVectors);
        }

        m_geoLines.data(lineData)
        .line(function () {
            return lineRecord;
        })
        .position(function (d, didx, item, iidx) {
            var dat = lineData[iidx];
            return {
                x: dat[d.x_column],
                y: dat[d.y_column]
            };
        })
        .style({
            strokeColor: function (d) {
                return d.strokeColor;
            },
            strokeWidth: 5,
            strokeOpacity: function (d, didx, item, iidx) {
                return lineData[iidx].hide ? -1 : params.opacity;
            }
        });
    };

    /* Set the map to display pickup AND dropoff points.
     */
    this.setMapDisplayToBothPoints = function () {
        var data = m_mapData, params = m_mapParams, pointData = data.data,
            i;

        data.numPoints = Math.min(data.data.length, this.maximumMapPoints) * 2;
        data.numLines = 0;
        m_geoLines.data([]);
        data.numPolygons = 0;
        m_geoPoly.data([]);

        data.x1_column = data.columns.pickup_longitude;
        data.y1_column = data.columns.pickup_latitude;
        data.x2_column = data.columns.dropoff_longitude;
        data.y2_column = data.columns.dropoff_latitude;
        var pointArray = new Array(data.numPoints);
        for (i = 0; i < pointArray.length; i += 1) {
            pointArray[i] = i;
        }
        m_geoPoints.data(pointArray)
        .style({
            fillColor: function (d) {
                /*jshint bitwise: false */
                return (!(d & 1)) ? m_pickupColor : m_dropoffColor;
            },
            fillOpacity: params.opacity,
            stroke: false,
            radius: 5
        })
        .position(function (d) {
            /*jshint bitwise: false */
            var i = d >> 1;
            /*jshint bitwise: false */
            if (!(d & 1)) {
                return {
                    x: pointData[i][data.x1_column],
                    y: pointData[i][data.y1_column]
                };
            } else {
                return {
                    x: pointData[i][data.x2_column],
                    y: pointData[i][data.y2_column]
                };
            }
        });
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
        var oldData = m_animationData;
        m_animationData = null;
        if (!m_mapData || !m_mapData.data ||
                !m_mapData.data.length || options.playState === 'stop') {
            return;
        }
        var data = m_mapData.data;
        var dateColumn = m_mapData.columns.pickup_datetime;
        if (m_mapParams['display-type'] === 'dropoff' &&
                m_mapParams['display-process'] !== 'binned') {
            dateColumn = m_mapData.columns.dropoff_datetime;
        }
        var dateColumn2 = m_mapData.columns.dropoff_datetime;
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
        var dataLength = m_mapData.numPoints;
        if (m_mapParams['display-type'] === 'vector') {
            dataLength = m_mapData.numLines;
        }
        if (m_mapParams['display-process'] === 'binned') {
            dataLength = data.length;
        }
        var params = {
            numBins: numBins,
            steps: steps,
            substeps: substeps,
            bins: [],
            dataBin: new Int32Array(dataLength),
            opacity: options.opacity,
            timestep: (options['cycle-steptime'] || 1000) / substeps,
            loops: options.loops,
            statusElem: options.statusElem,
            sliderElem: options.sliderElem,
            playState: options.playState || 'play'
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
        switch (m_mapParams['display-process']) {
            case 'binned':
                params.dataBin2 = new Int32Array(dataLength);
                for (i = 0; i < data.length; i += 1) {
                    params.dataBin[i] = Math.floor(((
                        data[i][dateColumn] - start) % range) / binWidth);
                    params.dataBin2[i] = Math.floor(((
                        data[i][dateColumn2] - start) % range) / binWidth);
                }
                /* Calculate a general scale */
                for (i = 0; i < numBins; i += substeps) {
                    this.binMapData(m_mapParams, params, i, !i);
                }
                break;
            default:
                switch (m_mapParams['display-type']) {
                    case 'both':
                        for (i = 0; i < m_mapData.numPoints; i += 1) {
                            /*jshint bitwise: false */
                            params.dataBin[i] = Math.floor(((
                                data[i >> 1][(!(i & 1)) ? dateColumn :
                                dateColumn2] - start) % range) / binWidth);
                        }
                        break;
                    case 'vector':
                        for (i = 0; i < m_mapData.numLines; i += 1) {
                            params.dataBin[i] = Math.floor(((
                                data[i][dateColumn] - start) % range) /
                                binWidth);
                        }
                        break;
                    default:
                        for (i = 0; i < m_mapData.numPoints; i += 1) {
                            params.dataBin[i] = Math.floor(((
                                data[i][dateColumn] - start) % range) /
                                binWidth);
                        }
                        break;
                }
                break;
        }
        m_animationData = params;
    };

    /* Check if a binned animation value is in the current display step.
     *
     * @param bin: the animation bin number.
     * @param numBins: the number of animation bins.
     * @param step: the current animation step [0-numBins).
     * @param subSteps: number of steps to group together.
     * @return: true if the bin should be shown, false otherwise. */
    this.inAnimationBin = function (bin, numBins, step, substeps) {
        if (bin < 0 || bin >= numBins) {
            return false;
        }
        return ((bin >= step && bin < step + substeps) ||
            bin + numBins < step + substeps);
    };

    /* Draw a frame of an animation.  If the current playState is 'play', set
     * a timer to play the next frame.
     */
    this.animateFrame = function () {
        var view = this, vpf, bin, vis, i, j, v, opac;

        if (!m_mapData || !m_mapData.data || !m_animationData) {
            return;
        }
        var options = m_animationData;
        options.step = (options.step + 1) % options.numBins;
        options.renderedSteps = (options.renderedSteps || 0) + 1;
        var visOpac = (options.opacity || 0.1);
        if (m_mapParams['display-process'] === 'binned') {
            this.binMapData(m_mapParams, options, options.step);
            this.setMapDisplayToBinnedData(m_mapParams);
        } else if (m_mapData.numPoints) {
            vpf = m_geoPoints.verticesPerFeature();
            opac = m_geoPoints.actors()[0].mapper().getSourceBuffer(
                'fillOpacity');
            for (i = 0, v = 0; i < m_mapData.numPoints; i += 1) {
                vis = this.inAnimationBin(options.dataBin[i], options.numBins,
                                          options.step, options.substeps);
                vis = (vis ? visOpac : 0);
                for (j = 0; j < vpf; j += 1, v += 1) {
                    opac[v] = vis;
                }
            }
            m_geoPoints.actors()[0].mapper().updateSourceBuffer('fillOpacity');
        } else if (m_mapData.numLines) {
            vpf = m_geoLines.verticesPerFeature();
            opac = m_geoLines.actors()[0].mapper().getSourceBuffer(
                'strokeOpacity');
            for (i = 0, v = 0; i < m_mapData.numLines; i += 1) {
                vis = this.inAnimationBin(options.dataBin[i], options.numBins,
                                          options.step, options.substeps);
                vis = (vis && !m_mapData.data[i].hide ? visOpac : -1);
                for (j = 0; j < vpf; j += 1, v += 1) {
                    opac[v] = vis;
                }
            }
            m_geoLines.actors()[0].mapper().updateSourceBuffer(
                'strokeOpacity');
        }
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
        if (!m_mapData || !m_mapData.data) {
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
                var vpf, opac, v;
                if (m_mapParams['display-process'] === 'binned') {
                    this.binMapData(m_mapParams);
                    this.setMapDisplayToBinnedData(m_mapParams);
                } else if (m_mapData.numPoints) {
                    vpf = m_geoPoints.verticesPerFeature();
                    opac = m_geoPoints.actors()[0].mapper().getSourceBuffer(
                        'fillOpacity');
                    for (v = 0; v < m_mapData.numPoints * vpf; v += 1) {
                        opac[v] = m_mapParams.opacity;
                    }
                    m_geoPoints.actors()[0].mapper().updateSourceBuffer(
                        'fillOpacity');
                } else if (m_mapData.numLines) {
                    vpf = m_geoLines.verticesPerFeature();
                    opac = m_geoLines.actors()[0].mapper().getSourceBuffer(
                        'strokeOpacity');
                    for (var i = 0, j = 0; i < m_mapData.numLines; i += 1) {
                        for (v = 0; v < vpf; v += 1, j += 1) {
                            opac[j] = (m_mapData.data[i].hide ? 0 :
                                       m_mapParams.opacity);
                        }
                    }
                    m_geoLines.actors()[0].mapper().updateSourceBuffer(
                        'strokeOpacity');
                }
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
            if (m_animationData.playState != curPlayState &&
                (!curPlayState || !m_animationData ||
                curPlayState.substr(0, 4) !== 'step' ||
                m_animationData.playState.substr(0, 4) !== 'step')) {
                geoapp.activityLog.logSystem('Animation action', {
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
            geoMap: m_geoMap,
            mapLayer: m_mapLayer,
            geoPoints: m_geoPoints,
            geoLines: m_geoLines,
            geoPoly: m_geoPoly,
            mapData: m_mapData,
            mapParams: m_mapParams,
            lastQueryOptions: m_lastQueryOptions,
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

    /* Make sure a bin exists.  If not, create it.
     *
     * @param bins: object to store bins.
     * @param x: first bin coordinate.
     * @param y: second bin coordiante.
     * @return: the desired bin.
     */
    this.ensureBinExists = function (bins, x, y) {
        if (!bins[x]) {
            bins[x] = {};
        }
        if (!bins[x][y]) {
            bins[x][y] = {
                x: x, y: y,
                pickups: 0, pickupPoints: [],
                dropoffs: 0, dropoffPoints: [],
                dx: 0, dy: 0, count: 0
            };
        }
        return bins[x][y];
    };

    /* Bin the map data.
     *
     * @param params: the display parameters for the map.
     * @param anim: animation options.  null for full display.
     * @param step: if animation options are specified, this is the step of the
     *              animation.
     * @param resetmax: if animation options are specified and this is true,
     *                  reset the bin max values.
     */
    this.binMapData = function (params, anim, step, resetmax) {
        var numBins = Math.max(params['display-num-bins'] || 15, 5);
        var node = m_geoMap.node(),
            width = node.width(), height = node.height(),
            bounds = m_geoMap.bounds();
        var binSize = Math.min(width, height) / numBins;
        var x0 = bounds.upperLeft.x, x1 = bounds.lowerRight.x,
            y1 = bounds.upperLeft.y, y0 = bounds.lowerRight.y;
        var binW = (x1 - x0) / width * binSize,
            binH = (y1 - y0) / height * binSize;
        var maxx = width <= height ? numBins : Math.ceil((x1 - x0) / binW),
            maxy = height <= width ? numBins : Math.ceil((y1 - y0) / binH);
        var binX0 = x0 + (x1 - x0 - binW * maxx) / 2;
        var binY0 = y0 + (y1 - y0 - binH * maxy) / 2;
        var data = m_mapData;
        data.x1_column = data.columns.pickup_longitude;
        data.y1_column = data.columns.pickup_latitude;
        data.x2_column = data.columns.dropoff_longitude;
        data.y2_column = data.columns.dropoff_latitude;
        var x, y, i, item, checkedBad;
        var bins = {}, bin;
        var computeVectors = (params['display-type'] === 'vector');

        for (i = 0; i < data.data.length; i += 1) {
            item = data.data[i];
            checkedBad = null;
            if (!anim || this.inAnimationBin(anim.dataBin[i], anim.numBins,
                                             step, anim.substeps)) {
                x = (item[data.x1_column] - binX0) / binW;
                y = (item[data.y1_column] - binY0) / binH;
                if (x >= 0 && x < maxx && y >= 0 && y < maxy) {
                    x = Math.floor(x);
                    y = Math.floor(y);
                    bin = this.ensureBinExists(bins, x, y);
                    bin.pickups += 1;
                    bin.pickupPoints.push(i);
                    if (computeVectors) {
                        checkedBad = this.isBadPoint(item, data);
                        if (!checkedBad) {
                            bin.dx += (item[data.x2_column] -
                                item[data.x1_column]);
                            bin.dy += (item[data.y2_column] -
                                item[data.y1_column]);
                            bin.count += 1;
                        }
                    }
                }
            }
            if (!anim || this.inAnimationBin(anim.dataBin2[i], anim.numBins,
                                             step, anim.substeps)) {
                x = (item[data.x2_column] - binX0) / binW;
                y = (item[data.y2_column] - binY0) / binH;
                if (x >= 0 && x < maxx && y >= 0 && y < maxy) {
                    x = Math.floor(x);
                    y = Math.floor(y);
                    bin = this.ensureBinExists(bins, x, y);
                    bin.dropoffs += 1;
                    bin.dropoffPoints.push(i);
                    if (computeVectors) {
                        if (checkedBad === null) {
                            checkedBad = this.isBadPoint(item, data);
                        }
                        if (!checkedBad) {
                            bin.dx -= (item[data.x2_column] -
                                item[data.x1_column]);
                            bin.dy -= (item[data.y2_column] -
                                item[data.y1_column]);
                            bin.count += 1;
                        }
                    }
                }
            }
        }
        data.bins = bins;
        var maxpickup = 0, maxdropoff = 0, maxflux = 0, maxvector = 0;
        if (anim && !resetmax && data.binAnimParams) {
            maxpickup = data.binAnimParams.maxpickup || 0;
            maxdropoff = data.binAnimParams.maxdropoff || 0;
            maxflux = data.binAnimParams.maxflux || 0;
            maxvector = data.binAnimParams.maxvector || 0;
        }
        data.binParams = {
            extents: {x0: x0, y0: y0, x1: x1, y1: y1},
            screen: {w: width, h: height},
            w: binW,
            h: binH,
            x0: binX0,
            y0: binY0,
            binSize: binSize
        };
        var bp = data.binParams;

        _.each(bins, function (binx, x) {
            _.each(binx, function (bin, y) {
                var flux, dx, dy, ctr, vec;

                flux = Math.abs(bin.pickups - bin.dropoffs);
                if (flux > maxflux) {
                    maxflux = flux;
                }
                if (bins[x][y].pickups > maxpickup) {
                    maxpickup = bins[x][y].pickups;
                }
                if (bins[x][y].dropoffs > maxdropoff) {
                    maxdropoff = bins[x][y].dropoffs;
                }
                if (!bin.count) {
                    return;
                }
                dx = bin.dx / bin.count;
                dy = bin.dy / bin.count;
                ctr = {
                    x: (bin.x + 0.5) * bp.w + bp.x0,
                    y: (bin.y + 0.5) * bp.h + bp.y0
                };
                bin.dx /= bin.count;  bin.dy /= bin.count;
                if (params['display-vector-length'] !== 'full') {
                    vec = m_geoMap.gcsToDisplay({x: ctr.x + dx, y: ctr.y + dy});
                    ctr = m_geoMap.gcsToDisplay(ctr);
                    bin.dx = vec.x - ctr.x;
                    bin.dy = vec.y - ctr.y;
                    bin.veclen = Math.sqrt(bin.dx * bin.dx + bin.dy * bin.dy);
                    bin.theta = Math.atan2(bin.dy, bin.dx);
                    if (bin.veclen > maxvector && bin.count >= 10) {
                        maxvector = bin.veclen;
                    }
                }
            });
        });
        bp.maxflux = maxflux;
        bp.maxpickup = maxpickup;
        bp.maxdropoff = maxdropoff;
        bp.maxvector = maxvector;
        if (anim) {
            data.binAnimParams = {
                maxflux: maxflux,
                maxpickup: maxpickup,
                maxdropoff: maxdropoff,
                maxvector: maxvector
            };
        }
    };

    /* Set the map data to polygons representing the binned data.
     *
     * @param params: the display parameters for the map.
     * @param anim: animation options.  null for full display.
     */
    this.setMapDisplayToBinnedData = function (params) {
        var data = m_mapData;
        var bp = data.binParams;

        data.numLines = 0;
        m_geoLines.data([]);
        data.numPoints = 0;
        m_geoPoints.data([]);

        var polyData = [];
        var coor = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}, {x: 1, y: 0},
                    {x: 0, y: 0}];
        _.each(data.bins, function (binx, x) {
            _.each(binx, function (bin, y) {
                polyData.push({bin: bin, outer: coor});
            });
        });
        data.numPolygons = polyData.length;

        m_geoPoly.data(polyData)
        .position(function (d, didx, item) {
            var bin = item.bin;
            return {
                x: (bin.x + d.x) * bp.w + bp.x0,
                y: (bin.y + d.y) * bp.h + bp.y0
            };
        })
        .style({
            fillColor: function (d, didx, item) {
                switch (params['display-type']) {
                    case 'both': case 'vector':
                        return (item.bin.pickups > item.bin.dropoffs ?
                        m_pickupColor : m_dropoffColor);
                    case 'dropoff':
                        return m_dropoffOnlyColor;
                    default:
                        return m_pickupOnlyColor;
                }
            },
            fillOpacity: function (d, didx, item) {
                var val;
                switch (params['display-type']) {
                    case 'both': case 'vector':
                        val = Math.abs(item.bin.pickups -
                            item.bin.dropoffs) / bp.maxflux;
                        break;
                    case 'dropoff':
                        val = item.bin.dropoffs / bp.maxdropoff;
                        break;
                    default:
                        val = item.bin.pickups / bp.maxpickup;
                        break;
                }
                /* We may want to apply a power function.  For instance,
                 *   return Math.pow(val, Math.log10(2));
                 * would scale 0.1 to 0.5, 0.01 to 0.25, etc. */
                return val;
            }
        });
        if (params['display-type'] === 'vector' && (bp.maxvector ||
                params['display-vector-length'] === 'full')) {
            var lineRecord = [0, 1];
            var maxvector = (bp.maxvector || 0) / m_maxVectorScale;
            m_geoLines.data(polyData)
            .line(function () {
                return lineRecord;
            })
            .position(function (d, didx, item, iidx) {
                var bin = polyData[iidx].bin;
                var coor = {
                    x: (bin.x + 0.5) * bp.w + bp.x0,
                    y: (bin.y + 0.5) * bp.h + bp.y0
                };
                if (d) {
                    if (params['display-vector-length'] !== 'full') {
                        var veclen = (bin.veclen < maxvector ?
                            bin.veclen : maxvector);
                        veclen *= bp.binSize / maxvector / 2;
                        coor = m_geoMap.gcsToDisplay(coor);
                        coor.x += Math.cos(bin.theta) * veclen;
                        coor.y += Math.sin(bin.theta) * veclen;
                        coor = m_geoMap.displayToGcs(coor);
                    } else {
                        coor.x += bin.dx;
                        coor.y += bin.dy;
                    }
                }
                return coor;
            })
            .style({
                strokeColor: 'black',
                strokeWidth: 5,
                strokeOpacity: function (d, didx, item, iidx) {
                    var bin = polyData[iidx].bin;
                    var val = Math.abs(bin.pickups - bin.dropoffs) / bp.maxflux;
                    return val;
                }
            });
        }
    };
};
