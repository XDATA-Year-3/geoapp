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

/* -------- general data layer -------- */

geoapp.addMapLayer = function (datainfo) {
    geoapp.mapLayers[datainfo.key] = function (map, arg) {
        'use strict';
        var datakey = datainfo.key;

        if (!(this instanceof geoapp.mapLayers[datakey])) {
            return new geoapp.mapLayers[datakey](map, arg);
        }
        arg = arg || {};
        geoapp.MapLayer.call(this, map, datakey, arg);

        var m_this = this,
            m_geoPoints, m_geoPoly,
            m_color = geo.util.convertColor(datainfo.color || 'black');

        var geoLayer;

        geoLayer = map.getMap().createLayer('feature', {
            renderer: 'vgl'
        });
        m_geoPoints = geoLayer.createFeature('point', {
            primitiveShape: 'triangle',
            selectionAPI: false,
            dynamicDraw: true
        });
        geoLayer = map.getMap().createLayer('feature', {
            renderer: 'vgl'
        });
        m_geoPoly = geoLayer.createFeature('polygon', {
            selectionAPI: false,
            dynamicDraw: true
        });

        this.paramChangedKeys = [
            'display-type',
            'display-process-' + datakey,
            'display-' + datakey + '-num-bins',
            'display-max-' + datakey + '-points',
            datakey + '-opacity',
            'display-date_min', 'display-date_max',
            'show-' + datakey + '-data'
        ];

        /* Set the map to display  points.
         *
         */
        this.setMapDisplayToPoints = function () {
            var data = m_this.data(true), params = m_this.map.getMapParams();

            data.numPoints = Math.min(data.data.length, this.maximumMapPoints);
            data.numPolygons = 0;
            m_geoPoly.data([]);
            data.x_column = data.columns.longitude;
            data.y_column = data.columns.latitude;
            var pointData = data.data || [];
            if (pointData.length > this.maximumMapPoints) {
                pointData = data.data.slice(0, this.maximumMapPoints);
            }
            m_geoPoints.data(pointData)
            .style({
                fillColor: m_color,
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
                    dx: 0, dy: 0, count: 0
                };
            }
            return bins[x][y];
        };

        /* Bin the map data.
         *
         * @param params: the display parameters for the map.
         * @param anim: animation options.  null for full display.
         * @param step: if animation options are specified, this is the step of
         *              the animation.
         * @param resetmax: if animation options are specified and this is true,
         *                  reset the bin max values.
         */
        this.binMapData = function (params, anim, step, resetmax) {
            var numBins = Math.max(params[
                'display-' + datakey + '-num-bins'] || 15, 5);
            var node = m_this.map.getMap().node(),
                width = node.width(), height = node.height(),
                bounds = m_this.map.getMap().bounds();
            var binSize = Math.min(width, height) / numBins;
            var x0 = bounds.upperLeft.x, x1 = bounds.lowerRight.x,
                y1 = bounds.upperLeft.y, y0 = bounds.lowerRight.y;
            var binW = (x1 - x0) / width * binSize,
                binH = (y1 - y0) / height * binSize;
            var maxx = width <= height ? numBins : Math.ceil((x1 - x0) / binW),
                maxy = height <= width ? numBins : Math.ceil((y1 - y0) / binH);
            var binX0 = x0 + (x1 - x0 - binW * maxx) / 2;
            var binY0 = y0 + (y1 - y0 - binH * maxy) / 2;
            var data = m_this.data(true);
            data.x1_column = data.columns.longitude;
            data.y1_column = data.columns.latitude;
            var x, y, i, item, checkedBad;
            var bins = {}, bin;

            for (i = 0; i < data.data.length; i += 1) {
                item = data.data[i];
                checkedBad = null;
                if (!anim || this.inAnimationBin(
                        anim.layers[datakey].dataBin[i], anim.numBins, step,
                        anim.substeps)) {
                    x = (item[data.x1_column] - binX0) / binW;
                    y = (item[data.y1_column] - binY0) / binH;
                    if (x >= 0 && x < maxx && y >= 0 && y < maxy) {
                        x = Math.floor(x);
                        y = Math.floor(y);
                        bin = this.ensureBinExists(bins, x, y);
                        bin.pickups += 1;
                        bin.pickupPoints.push(i);
                    }
                }
                if (!anim || this.inAnimationBin(
                        anim.layers[datakey].dataBin[i], anim.numBins, step,
                        anim.substeps)) {
                    x = (item[data.x2_column] - binX0) / binW;
                    y = (item[data.y2_column] - binY0) / binH;
                    if (x >= 0 && x < maxx && y >= 0 && y < maxy) {
                        x = Math.floor(x);
                        y = Math.floor(y);
                        bin = this.ensureBinExists(bins, x, y);
                    }
                }
            }
            data.bins = bins;
            var maxpickup = 0;
            if (anim && !resetmax && data.binAnimParams) {
                maxpickup = data.binAnimParams.maxpickup || 0;
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
                    var dx, dy, ctr;

                    if (bins[x][y].pickups > maxpickup) {
                        maxpickup = bins[x][y].pickups;
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
                });
            });
            bp.maxpickup = maxpickup;
            if (anim) {
                data.binAnimParams = {
                    maxpickup: maxpickup
                };
            }
        };

        /* Set the map data to polygons representing the binned data.
         *
         * @param params: the display parameters for the map.
         * @param anim: animation options.  null for full display.
         */
        this.setMapDisplayToBinnedData = function () {
            var data = m_this.data(true);
            var bp = data.binParams;

            data.numPoints = 0;
            m_geoPoints.data([]);

            var polyData = [];
            var coor = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}, {x: 1, y: 0},
                        {x: 0, y: 0}];
            _.each(data.bins, function (binx) {
                _.each(binx, function (bin) {
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
                fillColor: m_color,
                fillOpacity: function (d, didx, item) {
                    return item.bin.pickups / bp.maxpickup;
                }
            });
        };

        /* Update the taxi map based on the map parameters.  Values that are
         * updated include:
         *    display-process: 'raw' or 'binned'.
         *    opacity: the opacity used for non-animated points and lines.
         *
         * @param params: the new map parameters.
         */
        this.updateMapParams = function (params) {
            var visParam = {
                    dateMin: params['display-date_min'] ?
                        0 + moment.utc(params['display-date_min']) : null,
                    dateMax: params['display-date_max'] ?
                        0 + moment.utc(params['display-date_max']) : null,
                    dateColumn: 'date'
                },
                data = m_this.data(true, visParam),
                visible = (params['show-' + datakey + '-data'] !== false &&
                           data);
            m_geoPoints.visible(visible);
            m_geoPoly.visible(visible);
            $('.ga-legend-item.legend-' + datakey).addClass('hidden');
            if (!visible) {
                return;
            }
            $('.ga-legend-item.legend-' + datakey + '.' + datakey + '-' +
                params['display-process-' + datakey]).removeClass('hidden');
            if (params['display-max-' + datakey + '-points'] > 0) {
                this.maximumMapPoints = params[
                    'display-max-' + datakey + '-points'];
            }
            if (params[datakey + '-opacity'] > 0) {
                params.opacity = params[datakey + '-opacity'];
            }
            switch (params['display-process-' + datakey]) {
                case 'binned':
                    this.binMapData(params);
                    this.setMapDisplayToBinnedData(params);
                    break;
                default:
                    this.setMapDisplayToPoints();
                    break;
            }
        };

        /* Return the index of the date column for this data.
         *
         * @return: the date column, or null if undefined. */
        this.getDateColumn = function () {
            var data = m_this.data();
            if (!data || !data.columns) {
                return null;
            }
            return data.columns.date;
        };

        /* Calculate bins for animation
         *
         * @param param: animation parameters.  The dataBin field should be
         *               added at a minimum.
         * @param start: start of animation interval in epoch milliseconds.
         * @param range: milliseconds for animation cycle (for instance, if
         *               this is showing one week, collecting all the weeks in
         *               a year, this is the number of ms in a week).
         * @param binWidth: width of each bin in milliseconds.
         */
        this.binForAnimation = function (params, start, range, binWidth) {
            var mapParams = m_this.map.getMapParams(),
                mapData = m_this.data(true),
                dateColumn = this.getDateColumn(),
                data, i;

            if (!mapData || !mapData.data) {
                return;
            }
            data = mapData.data;
            var dataLength = mapData.numPoints;
            if (data.length < dataLength) {
                dataLength = data.length;
            }
            if (mapParams['display-process-' + datakey] === 'binned') {
                dataLength = data.length;
            }
            var dataBin = new Int32Array(dataLength);
            params.layers[datakey] = {dataBin: dataBin};

            switch (mapParams['display-process-' + datakey]) {
                case 'binned':
                    for (i = 0; i < data.length; i += 1) {
                        dataBin[i] = Math.floor(((
                            data[i][dateColumn] - start) % range) / binWidth);
                    }
                    /* Calculate a general scale */
                    for (i = 0; i < params.numBins; i += params.substeps) {
                        this.binMapData(mapParams, params, i, !i);
                    }
                    break;
                default:
                    for (i = 0; i < dataLength; i += 1) {
                        dataBin[i] = Math.floor(((
                            data[i][dateColumn] - start) % range) /
                            binWidth);
                    }
                    break;
            }
        };

        /* Update the animation frame for this layer.
         *
         * @param options: animation options.
         */
        this.animateFrame = function (options) {
            if (!options.layers[datakey]) {
                return;
            }
            var mapParams = m_this.map.getMapParams(),
                mapData = m_this.data(true),
                visOpac = (options.opacity || 0.1),
                dataBin = options.layers[datakey].dataBin,
                i, j, v, opac, vis, vpf;

            if (mapParams[datakey + '-opacity']) {
                visOpac = Math.min(mapParams[datakey + '-opacity'] * 1.5, 1);
            }
            if (mapParams['display-process-' + datakey] === 'binned') {
                this.binMapData(mapParams, options, options.step);
                this.setMapDisplayToBinnedData(mapParams);
            } else if (mapData.numPoints) {
                vpf = m_geoPoints.verticesPerFeature();
                opac = m_geoPoints.actors()[0].mapper().getSourceBuffer(
                    'fillOpacity');
                for (i = 0, v = 0; i < mapData.numPoints; i += 1) {
                    vis = this.inAnimationBin(
                        dataBin[i], options.numBins, options.step,
                        options.substeps);
                    vis = (vis ? visOpac : 0);
                    for (j = 0; j < vpf; j += 1, v += 1) {
                        opac[v] = vis;
                    }
                }
                m_geoPoints.actors()[0].mapper().updateSourceBuffer(
                    'fillOpacity');
            }
        };

        /* Stop any animation and show the unanimated data.
         */
        this.animateStop = function () {
            var mapParams = m_this.map.getMapParams(),
                mapData = m_this.data(true),
                vpf, opac, v;

            if (!mapData) {
                return;
            }
            if (mapParams['display-process-' + datakey] === 'binned') {
                this.binMapData(mapParams);
                this.setMapDisplayToBinnedData(mapParams);
            } else if (mapData.numPoints) {
                vpf = m_geoPoints.verticesPerFeature();
                opac = m_geoPoints.actors()[0].mapper().getSourceBuffer(
                    'fillOpacity');
                for (v = 0; v < mapData.numPoints * vpf; v += 1) {
                    opac[v] = mapParams.opacity;
                }
                m_geoPoints.actors()[0].mapper().updateSourceBuffer(
                    'fillOpacity');
            }
        };

        /* Return the current internal state of the layer.
         *
         * @param key: the key of the object to fetch, or undefined for a
         *             dictionary of objects.
         * @returns: a dictionary of the current state, or one of the internal
         *           state objects.
         */
        this.getInternalState = function (key) {
            var state = {
                geoPoints: m_geoPoints,
                geoPoly: m_geoPoly,
                color: m_color
            };
            if (key) {
                return state[key];
            }
            return state;
        };
    };

    inherit(geoapp.mapLayers[datainfo.key], geoapp.MapLayer);
};
