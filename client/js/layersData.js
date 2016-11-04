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

/* globals geoapp, geo, moment, inherit, d3 */

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
            m_color = geo.util.convertColor(datainfo.color || 'black'),

            m_overlayTimer,
            m_mapEventsSet,
            m_currentPoint = null,
            m_currentPointSource = '',
            m_persistentCurrentPoint = false,
            m_inPoints = {top: [], other: []},
            m_lastMouseDownEvent,
            m_lastPanEvent,

            m_pointColorStr = '#FF0000',
            m_pointColor = geo.util.convertColor(m_pointColorStr),
            m_strokeColorStr = '#E69F00',
            m_strokeColor = geo.util.convertColor(m_strokeColorStr),

            /* If both recentPointCount and recentPointTime are falsy, no
             * recent point highlighting is performed.  Otherwise,
             * recentPointCount is used in preference to recentPointTime.  When
             * used, points are drawn in pointColor and with the opacity
             * multiplied by recentOpacityBoost for the number of recent points
             * or duration of the recent time.  The points are transitioned to
             * oldPointColor across the either the lessRecentPointCount or
             * lessRecentPointTime as appropriate. */
            m_recentOpacityBoost = 4,
            m_recentRadius = 7,
            m_recentPointCount = 0,
            m_lessRecentPointCount = 0,
            m_recentPointTime = 0,
            m_lessRecentPointTime = 0,
            m_oldPointColorStr = '#800000',
            m_oldPointColor = geo.util.convertColor(m_oldPointColorStr);

        var geoLayer;

        var recentMsg = datainfo.recent;
        if (recentMsg) {
            m_recentOpacityBoost = (recentMsg.recentOpacityBoost !== undefined ? recentMsg.recentOpacityBoost : m_recentOpacityBoost);
            m_recentRadius = (recentMsg.recentRadius !== undefined ? recentMsg.recentRadius : m_recentRadius);
            m_recentPointCount = (recentMsg.recentPointCount !== undefined ? recentMsg.recentPointCount : m_recentPointCount);
            m_lessRecentPointCount = (recentMsg.lessRecentPointCount !== undefined ? recentMsg.lessRecentPointCount : m_lessRecentPointCount);
            m_recentPointTime = (recentMsg.recentPointTime !== undefined ? recentMsg.recentPointTime : m_recentPointTime);
            m_lessRecentPointTime = (recentMsg.lessRecentPointTime !== undefined ? recentMsg.lessRecentPointTime : m_lessRecentPointTime);
            m_oldPointColorStr = (recentMsg.oldPointColor !== undefined ? recentMsg.oldPointColor : m_oldPointColorStr);
            m_oldPointColor = geo.util.convertColor(m_oldPointColorStr);
            m_pointColorStr = (recentMsg.pointColor !== undefined ? recentMsg.pointColor : m_pointColorStr);
            m_pointColor = geo.util.convertColor(m_pointColorStr);
            m_strokeColorStr = (recentMsg.strokeColor !== undefined ? recentMsg.strokeColor : m_strokeColorStr);
            m_strokeColor = geo.util.convertColor(m_strokeColorStr);
        }

        geoLayer = map.getMap().createLayer('feature', {
            renderer: 'vgl'
        });
        m_geoPoints = geoLayer.createFeature('point', {
            primitiveShape: 'triangle',
            selectionAPI: !!datainfo.results_id,
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
            'display-' + datakey + '-field-color',
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
            var color = m_color,
                opacity = params.opacity,
                radius = 5,
                fieldColor = params['display-' + datakey + '-field-color'];
            if (data.columns[fieldColor] !== undefined) {
                data.field_color_column = data.columns[fieldColor];
                var range, cat, cattbl, i;
                for (i = 0; i < (datainfo.fieldColors || []).length; i += 1) {
                    if (datainfo.fieldColors[i].field === fieldColor) {
                        range = datainfo.fieldColors[i].range;
                        cat = datainfo.fieldColors[i].category;
                        break;
                    }
                }
                if (range) {
                    for (i = 0; i < range.length; i += 1) {
                        range[i].rgb = geo.util.convertColor(range[i].color);
                    }
                    color = function (d, idx) {
                        var value = d[data.field_color_column], i, p, p1;
                        if (value <= range[0].value) {
                            return range[0].rgb;
                        }
                        for (i = 1; i < range.length; i += 1) {
                            if (value <= range[i].value) {
                                p = (value - range[i].value) / (range[i - 1].value - range[i].value);
                                p1 = 1 - p;
                                return {
                                    r: range[i - 1].rgb.r * p + range[i].rgb.r * p1,
                                    g: range[i - 1].rgb.g * p + range[i].rgb.g * p1,
                                    b: range[i - 1].rgb.b * p + range[i].rgb.b * p1
                                };
                            }
                        }
                        return range[range.length - 1].rgb;
                    };
                } else if (cat) {
                    cattbl = {'_other_': color};
                    for (i = 0; i < cat.length; i += 1) {
                        cat[i].rgb = geo.util.convertColor(cat[i].color);
                        if (cat[i].value !== '') {
                            cattbl[cat[i].value] = cat[i].rgb;
                        } else {
                            cattbl['_other_'] = cat[i].rgb;
                        }
                    }
                    color = function (d, idx) {
                        var value = d[data.field_color_column];
                        if (cattbl[value] !== undefined) {
                            return cattbl[value];
                        }
                        return cattbl['_other_'];
                    };
                }
            } else if (m_recentPointCount || m_recentPointTime) {
                var recentData = this.adjustRecentPoints(
                    pointData, data.columns, color, opacity, radius);
                color = recentData.color;
                opacity = recentData.opacity;
                radius = recentData.radius;
            }
            m_geoPoints.data(pointData)
            .style({
                fillColor: color,
                fillOpacity: opacity,
                strokeColor: m_strokeColor,
                strokeOpacity: 1,
                strokeWidth: 5,
                stroke: function (d) {
                    return d._selected;
                },
                radius: radius
            })
            .position(function (d) {
                return {
                    x: d[data.x_column],
                    y: d[data.y_column]
                };
            })
            .geoOff(geo.event.feature.mouseover)
            .geoOn(geo.event.feature.mouseover, function (evt) {
                m_this.highlightPoint(evt.index, evt, true);
            })
            .geoOff(geo.event.feature.mouseout)
            .geoOn(geo.event.feature.mouseout, function (evt) {
                m_this.highlightPoint(evt.index, evt, false);
            });
            return pointData;
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
            var numBins = Math.max(params['display-' + datakey + '-num-bins'] || 15, 5);
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
            var x, y, i, item;
            var bins = {}, bin;

            for (i = 0; i < data.data.length; i += 1) {
                item = data.data[i];
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
                    if (bins[x][y].pickups > maxpickup) {
                        maxpickup = bins[x][y].pickups;
                    }
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
            m_geoPoints.data([])
            .geoOff(geo.event.feature.mouseover)
            .geoOff(geo.event.feature.mouseout);

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

        /* Update the map based on the map parameters.  Values that are
         * updated include:
         *    display-process: 'raw' or 'binned'.
         *    opacity: the opacity used for non-animated points and lines.
         *
         * @param params: the new map parameters.
         */
        this.updateMapParams = function (params) {
            var visParam = {
                    dateMin: params['display-date_min'] ? 0 + moment.utc(params['display-date_min']) : null,
                    dateMax: params['display-date_max'] ? 0 + moment.utc(params['display-date_max']) : null,
                    dateColumn: this.getDateColumnName(),
                    maxPoints: m_recentPointCount || m_recentPointTime ? this.maximumMapPoints : null,
                    sortByDate: m_recentPointCount || m_recentPointTime
                },
                data = m_this.data(true, visParam),
                visible = (params['show-' + datakey + '-data'] !== false &&
                           data),
                fieldColor = params['display-' + datakey + '-field-color'];
            m_geoPoints.visible(visible);
            m_geoPoly.visible(visible);
            var recent = ((m_recentPointCount || m_recentPointTime) && params['display-process-' + datakey] !== 'binned');
            $('.ga-legend-item.legend-' + datakey).addClass('hidden');
            if (!visible) {
                return;
            }
            if (!recent && data.columns[fieldColor] === undefined) {
                $('.ga-legend-item.legend-' + datakey + '.' + datakey + '-' +
                    params['display-process-' + datakey]).removeClass('hidden');
            } else if (data.columns[fieldColor] !== undefined) {
                $('.ga-legend-item.legend-' + datakey + '.legend-item-field-' + fieldColor).removeClass('hidden');
            } else {
                $('.ga-legend-item.legend-' + datakey + '.legend-item-old')
                    .removeClass('hidden');
                $('.ga-legend-item.legend-' + datakey + '.legend-item-new')
                    .removeClass('hidden');
            }
            if (params['display-max-' + datakey + '-points'] > 0) {
                this.maximumMapPoints = params['display-max-' + datakey + '-points'];
            }
            if (params[datakey + '-opacity'] > 0) {
                params.opacity = params[datakey + '-opacity'];
            }
            var pointData;
            switch (params['display-process-' + datakey]) {
                case 'binned':
                    this.binMapData(params);
                    this.setMapDisplayToBinnedData(params);
                    break;
                default:
                    pointData = this.setMapDisplayToPoints();
                    break;
            }
            m_geoPoints.layer().geoOff(geo.event.pan, m_this.panLayer)
            .geoOn(geo.event.pan, m_this.panLayer);
            $(this.map.getMap().node()).off('.' + datakey + '-map-layer').on(
                'mousedown.' + datakey + '-map-layer click.' + datakey + '-map-layer', m_this.clickLayer);
            /* Reset the tracked points */
            var oldcur = this.currentPoint(),
                oldcurInTop = $.inArray(oldcur, m_inPoints.top),
                oldcurInOther = $.inArray(oldcur, m_inPoints.other);
            m_inPoints = {top: [], other: []};
            if (!params.callNumber && oldcur) {
                /* If this is fresh data, clear the overlay */
                this.currentPoint(null, false);
            } else if (params.callNumber && oldcur) {
                /* If this is updated data, make sure the current point is
                 * what we want. */
                var newcur = null;
                if (pointData) {
                    _.find(pointData, function (d, idx) {
                        if (d._selected) {
                            newcur = idx;
                        }
                        return d._selected;
                    });
                }
                if (newcur !== null && newcur !== oldcur) {
                    this.currentPoint(newcur, null);
                }
                if (newcur !== null) {
                    if (oldcurInTop >= 0) {
                        m_inPoints.top.push(newcur);
                    } else if (oldcurInOther >= 0) {
                        m_inPoints.other.push(newcur);
                    }
                }
            }
        };

        /* Determine which points are recent and make sure they are differently
         * colored and differently opaque.
         *
         * @param data: the data array of points.
         * @param columns: the columns record used to determine what date to
         *                 use.
         * @param color: the color for recent points.
         * @param opacity: the base opacity for points.
         * @param radius: the base radius for points.
         * @returns: the new color, opacity, and radius which may be functions.
         */
        this.adjustRecentPoints = function (data, columns, color, opacity,
                radius) {
            var len = data.length, diff = 0,
                res = {color: m_oldPointColor, opacity: opacity, radius: radius};
            if (!len || !columns || this.getDateColumnName(data) === null) {
                res.color = color;
                return res;
            }
            if (m_recentPointCount) {
                var deltapos = m_lessRecentPointCount || 0,
                    newpos = len - m_recentPointCount,
                    oldpos = newpos - deltapos;
                diff = true;
                _.each(data, function (d, idx) {
                    if (idx <= oldpos) {
                        delete d.recent;
                    } else if (idx >= newpos) {
                        d.recent = 1;
                    } else {
                        d.recent = (idx - oldpos) / deltapos;
                    }
                });
            } else {
                var curtime = new Date().getTime(),
                    deltaval = (m_lessRecentPointTime || 0) * 1000,
                    newval = curtime - m_recentPointTime * 1000,
                    oldval = newval - deltaval,
                    col = this.getDateColumn(data);
                _.each(data, function (d) {
                    if (d[col] <= oldval) {
                        delete d.recent;
                    } else if (d[col] >= newval) {
                        d.recent = 1;
                        diff += 1;
                    } else {
                        d.recent = (d[col] - oldval) / deltaval;
                        diff += 1;
                    }
                });
            }
            if (diff) {
                if (color !== m_oldPointColor) {
                    res.color = function (d) {
                        var val = d.recent;
                        if (!val) {
                            return m_oldPointColor;
                        }
                        if (val === 1) {
                            return color;
                        }
                        var invval = 1 - val;
                        return {
                            r: m_pointColor.r * val + m_oldPointColor.r * invval,
                            g: m_pointColor.g * val + m_oldPointColor.g * invval,
                            b: m_pointColor.b * val + m_oldPointColor.b * invval
                        };
                    };
                }
                if (m_recentOpacityBoost > 1) {
                    var boost = (1 - Math.pow(1 - opacity, m_recentOpacityBoost) -
                                 opacity);
                    res.opacity = function (d) {
                        var val = d.recent, opac;
                        if (!val) {
                            return opacity;
                        }
                        opac = opacity + boost * val;
                        return opac;
                    };
                }
                if (radius !== m_recentRadius) {
                    res.radius = function (d) {
                        var val = d.recent;
                        if (!val) {
                            return radius;
                        }
                        if (val === 1) {
                            return m_recentRadius;
                        }
                        return (1 - val) * radius + val * m_recentRadius;
                    };
                }
            }
            return res;
        };

        /* Return the index of the date column for this data.
         *
         * @param data: if specified, use this data rather than the instance
         *              data.
         * @return: the date column, or null if undefined. */
        this.getDateColumn = function (data) {
            var colname = this.getDateColumnName(data);
            if (!data) {
                data = m_this.data();
            }
            return colname === null ? null : data.columns[colname];
        };

        /* Return the name of the date column for this data.
         *
         * @param data: if specified, use this data rather than the instance
         *              data.
         * @return: the name of the date column, or null if undefined. */
        this.getDateColumnName = function (data) {
            if (!data) {
                data = m_this.data();
            }
            if (!data || !data.columns) {
                return null;
            }
            var colname = _.find([datainfo.datekey, 'posted_date', 'msg_date', 'date'], function (name) {
                return data.columns[name] !== undefined;
            });
            return colname === undefined ? null : colname;
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

        /* When the mouse hovers above a point on the map, indicate this.
         *
         * @param idx: 0-based index in the data array.
         * @param evt: the event that triggered this call.
         * @param over: true if the mouse if over the point, false if it just
         *                   left.
         */
        this.highlightPoint = function (idx, evt, over) {
            var vpf = m_geoPoints.verticesPerFeature(),
                opac;
            if (over) {
                opac = m_geoPoints.actors()[0].mapper().getSourceBuffer(
                    'fillOpacity');
                if (idx * vpf >= opac.length || !opac[idx * vpf]) {
                    over = false;
                }
            }
            if ((!over || !evt.top) && $.inArray(idx, m_inPoints.top) >= 0) {
                m_inPoints.top.splice($.inArray(idx, m_inPoints.top), 1);
            }
            if ((!over || evt.top) && $.inArray(idx, m_inPoints.other) >= 0) {
                m_inPoints.other.splice($.inArray(idx, m_inPoints.other), 1);
            }
            if (over && evt.top && $.inArray(idx, m_inPoints.top) < 0) {
                m_inPoints.top.push(idx);
            }
            if (over && !evt.top && $.inArray(idx, m_inPoints.other) < 0) {
                m_inPoints.other.push(idx);
            }
            if (!m_persistentCurrentPoint) {
                this.currentPoint(this.getHighlightPoint(), undefined, undefined,
                                  'map');
            }
        };

        /* Return the first top-most point that should be highlighted by a
         * hovered or clicked mouse.
         *
         * @return: the 0-based point index or null.
         */
        this.getHighlightPoint = function () {
            if (m_inPoints.top.length) {
                return m_inPoints.top[0];
            }
            if (m_inPoints.other.length) {
                return m_inPoints.other[0];
            }
            return null;
        };

        /* Handle clicking on the map.  Set the current point according to
         * highlighting rules to a persistent point.
         *
         * @param evt: the event that triggered this call.
         */
        this.clickLayer = function (evt) {
            if (evt.type === 'mousedown') {
                m_lastMouseDownEvent = new Date().getTime();
                return;
            }
            if (m_lastMouseDownEvent < m_lastPanEvent) {
                return;
            }
            if (!m_geoPoints.visible()) {
                m_this.currentPoint(null, true, true, 'map');
                return;
            }
            var idx = m_this.getHighlightPoint();
            m_this.persistentCurrentPoint(idx);
            m_this.currentPoint(idx, true, true, 'map');
            evt.stopPropagation();
            evt.preventDefault();
        };

        /* When the map is panned, record that it was done so that we can
         * differentiate a click from a pan.  If we have a persistent overlay,
         * adjust its position.
         *
         * @param evt: the event that triggered this call.
         */
        this.panLayer = function (evt) {
            if (evt.screenDelta && !evt.screenDelta.x && !evt.screenDelta.y) {
                return;
            }
            m_lastPanEvent = new Date().getTime();
            if (m_persistentCurrentPoint && m_currentPoint !== null) {
                m_this.showOverlay(true);
            }
        };

        /* Get or set a point as the current point.  If setting, mark it as the
         * current point and set a timer to display the assocaited picture
         * soon.
         *
         * @param cur: undefined to get the current point.  Otherwise, the
         *             0-based point index, or null to clear the current point.
         * @param redraw: if false, don't redraw the map.  If true, always
         *                update.  If null, just set the currentPoint's
         *                internal value and return without doing anything
         *                else.
         * @param immediate: if true, show or hide the overlay immediately.
         * @param source: name of the source of setting this point.  Used in
         *                logging.
         * @param currentPoint: the current point (an integer) or null if there
         *                      is no current point.
         */
        this.currentPoint = function (cur, redraw, immediate, source) {
            if (cur === undefined) {
                return m_currentPoint;
            }
            m_currentPointSource = source || m_currentPointSource || '';
            cur = !isNaN(parseInt(cur)) ? parseInt(cur) : null;
            if (cur === m_currentPoint && redraw !== true) {
                return m_currentPoint;
            }
            if (cur === null) {
                m_persistentCurrentPoint = false;
            }
            var mapData = m_this.data(true);
            if (m_currentPoint !== null && m_currentPoint >= 0 &&
                    m_currentPoint < mapData.data.length) {
                delete mapData.data[m_currentPoint]._selected;
            }
            if (cur !== null && cur >= 0 && cur < mapData.data.length) {
                mapData.data[cur]._selected = true;
            }
            if (redraw === null) {
                m_currentPoint = cur;
                return m_currentPoint;
            }
            var vpf = m_geoPoints.verticesPerFeature(),
                stroke, i, old = m_currentPoint;

            stroke = m_geoPoints.actors()[0].mapper().getSourceBuffer('stroke');
            for (i = 0; i < vpf; i += 1) {
                if (old !== null && old * vpf < stroke.length) {
                    stroke[old * vpf + i] = 0;
                }
                if (cur !== null && cur * vpf < stroke.length) {
                    stroke[cur * vpf + i] = 1;
                }
            }
            m_geoPoints.actors()[0].mapper().updateSourceBuffer('stroke');
            if (redraw !== false) {
                this.map.triggerDraw();
            }
            m_currentPoint = cur;
            /* If no point is selected, use a shorter timeout for the overlay. */
            var delay = !cur ? 125 : 250;
            if (m_overlayTimer) {
                window.clearTimeout(m_overlayTimer);
                m_overlayTimer = null;
            }
            if (!immediate) {
                m_overlayTimer = window.setTimeout(this.showOverlay, delay);
            } else {
                this.showOverlay();
            }
            if (cur && !m_mapEventsSet && $('#ga-main-map').length) {
                $('#ga-main-map').on('mouseleave', function () {
                    if (!m_persistentCurrentPoint) {
                        m_this.currentPoint(null);
                    }
                });
                m_mapEventsSet = true;
            }
            return m_currentPoint;
        };

        /* Get or set if the current point is persistent. If it is persistent, a
         * close icon is shown on the overlay.
         *
         * @param persistent: if undefined, just return the state of
         *      persistence.  If an integer or a string that can be cast to an
         *      integer, set the persistence if this value is not the same as
         *      the current point or persistence if off.  If persistence in on
         *      and this is the currenr point, toggle it off.  If not an
         *      integer, set the persistence to the truthiness of this value.
         * @param source: source of this call for logging.
         * @return: a boolean with the state of persistence.
         */
        this.persistentCurrentPoint = function (persistent, source) {
            if (persistent === undefined) {
                return m_persistentCurrentPoint;
            }
            if (!isNaN(parseInt(persistent))) {
                persistent = parseInt(persistent);
                persistent = (!m_persistentCurrentPoint ||
                              persistent !== m_currentPoint);
            }
            persistent = !!persistent;
            if (persistent !== m_persistentCurrentPoint) {
                geoapp.activityLog.logActivity('pin_overlay',
                    source || 'map', {}, 'instagram_overlay');
            }
            m_persistentCurrentPoint = persistent;
            return m_persistentCurrentPoint;
        };

        /* Show or hide the overlay based on the current point.  If the current
         * point is off the screen, show the overlay as close to that point as
         * we can.
         *
         * @param onlyMove: if true, only update the position.
         */
        this.showOverlay = function (onlyMove) {
            m_overlayTimer = null;
            var mapData = m_this.data(true),
                overlay = $('#ga-instagram-overlay');
            if (m_currentPoint === null || !mapData.data ||
                    m_currentPoint >= mapData.data.length) {
                if (overlay.css('display') !== 'none') {
                    geoapp.activityLog.logActivity('hide_overlay', 'map', {
                        url: null
                    }, 'instagram_overlay');
                }
                overlay.css('display', 'none');
                return;
            }
            var item = mapData.data[m_currentPoint];
            var noCoord = (!item[mapData.columns.longitude] &&
                           !item[mapData.columns.latitude]);
            var mapW = $('#ga-main-map').width(),
                mapH = $('#ga-main-map').height(),
                pos = m_this.map.getMap().gcsToDisplay({
                    x: item[mapData.columns.longitude],
                    y: item[mapData.columns.latitude]
                }),
                offset = 10,
                url = item[mapData.columns.url] || item[mapData.columns.image_url],
                imageUrl = item[mapData.columns.image_url],
                caption = item[mapData.columns.caption || mapData.columns.msg] || '',
                date = moment(item[m_this.getDateColumn()]).utcOffset(0
                    ).format('YYYY MMM D HH:mm');
            if (pos.x >= 0 && pos.y >= 0 && pos.x <= mapW && pos.y <= mapH) {
                $('.ga-instagram-overlay-arrow', overlay).css('display', 'none');
                $('.ga-instagram-overlay-goto', overlay).css('visibility', '');
            } else if (noCoord) {
                pos.x = 0;
                pos.y = mapH;
                $('.ga-instagram-overlay-arrow', overlay).css('display', 'none');
                $('.ga-instagram-overlay-goto', overlay).css(
                    'visibility', 'hidden');
            } else {
                /* Clamp position to the screen, so that the overlay is always
                /* visible.  Point an arrow to where the point is located. */
                var dx = 0, dy = 0;
                /* jscs:disable requireBlocksOnNewline */
                if (pos.x < 0) {    dx = pos.x;         pos.x = 0; }
                if (pos.x > mapW) { dx = pos.x - mapW;  pos.x = mapW; }
                if (pos.y < 0) {    dy = pos.y;         pos.y = 0; }
                if (pos.y > mapH) { dy = pos.y - mapH;  pos.y = mapH; }
                /* jscs:enable requireBlocksOnNewline */
                $('.ga-instagram-overlay-arrow', overlay).css({
                    display: 'block',
                    transform: 'rotate(' + Math.atan2(dy, dx).toFixed(3) + 'rad)'
                });
                $('.ga-instagram-overlay-goto', overlay).css('visibility', '');
                offset = 0;
            }
            $('.ga-instagram-overlay-external', overlay).toggleClass(
                'hidden', !$('body').attr('intentsserver'));
            /* Bias very slightly to the upper right */
            var bias = 5,
                ctrX = mapW / 2 + bias,
                ctrY = mapH / 2 - bias;
            overlay.css({
                left:   pos.x < ctrX ? (pos.x + offset) + 'px' : '',
                right:  pos.x < ctrX ? '' : (mapW - pos.x + offset) + 'px',
                top:    pos.y < ctrY ? (pos.y + offset) + 'px' : '',
                bottom: pos.y < ctrY ? '' : (mapH - pos.y + offset) + 'px'
            });
            overlay.attr('point', m_currentPoint);
            if (onlyMove) {
                return;
            }
            $('.ga-instagram-overlay-date', overlay).text(date).attr(
                'title', date);
            $('.ga-instagram-overlay-caption', overlay).text(caption).attr(
                'title', caption);
            $('.ga-instagram-overlay-position', overlay).text(geoapp.formatLatLon({
                x: item[mapData.columns.longitude],
                y: item[mapData.columns.latitude]
            })).attr('title', geoapp.formatLatLon({
                x: item[mapData.columns.longitude],
                y: item[mapData.columns.latitude]
            }, true));
            $('.ga-instagram-overlay-title-bar', overlay).css('display',
                m_persistentCurrentPoint ? 'block' : 'none');
            overlay.off('.instagram-overlay');
            $('*', overlay).off('.instagram-overlay');
            if (!m_persistentCurrentPoint) {
                overlay.on('mouseenter.instagram-overlay', function () {
                    if (m_overlayTimer) {
                        window.clearTimeout(m_overlayTimer);
                        m_overlayTimer = null;
                    }
                }).on('mouseleave.instagram-overlay', function () {
                    m_overlayTimer = window.setTimeout(function () {
                        m_this.currentPoint(null, true, true);
                    }, 500);
                });
            } else {
                $('.ga-instagram-overlay-goto', overlay).on(
                        'click.instagram-overlay', m_this.centerOnMap);
                $('.ga-instagram-overlay-close-button', overlay).on(
                        'click.instagram-overlay', function () {
                            m_this.currentPoint(null, true, true);
                        });
            }
            $('.ga-instagram-overlay-arrow', overlay).on(
                'click.instagram-overlay', m_this.centerOnMap);
            $('.ga-instagram-overlay-external', overlay).on(
                'click.instagram-overlay', m_this.showIntentsMenu);
            if (url.indexOf('t/') === 0) {
                var parts = url.split('/');
                url = 'http://twitter.com/' + parts[1] + '/status/' + parts[2];
            } else if (url.indexOf('i/') === 0) {
                url = 'http://instagram.com/p/' + url.slice(2);
            }
            if (url.indexOf('twitter') < 0) {
                imageUrl = url.replace(/\/$/, '') + '/media?size=m';
            }
            $('.ga-instagram-overlay-link a', overlay).text(url).attr(
                'href', url);
            if ($('img', overlay).attr('orig_url') !== url) {
                overlay.css('display', 'none').addClass('no-overlay-image');
                $('img', overlay).off('.instagram-overlay').attr({orig_url: url});
                if (imageUrl) {
                    $('img', overlay).on('load.instagram-overlay', function () {
                        overlay.css('display', 'block');
                        overlay.removeClass('no-overlay-image');
                        geoapp.activityLog.logActivity('show_overlay', 'map', {
                            source: m_currentPointSource || '',
                            imageUrl: imageUrl,
                            url: url
                        }, 'instagram_overlay');
                    }).on('error.instagram-overlay', function () {
                        overlay.css('display', 'block');
                        geoapp.activityLog.logActivity('show_overlay', 'map', {
                            source: m_currentPointSource || '',
                            url: url
                        }, 'instagram_overlay');
                    }).attr({src: imageUrl});
                } else {
                    overlay.css('display', 'block');
                }
            } else {
                overlay.css('display', 'block');
            }
            $('[title]', overlay).each(function () {
                var elem = $(this),
                    title = elem.attr('title');
                elem.tooltip(geoapp.defaults.tooltip)
                .attr('data-original-title', title)
                .tooltip('fixTitle');
            });
        };

        /* Center the currently highlighted point on the map.
         */
        this.centerOnMap = function () {
            var mapData = m_this.data(true),
                overlay = $('#ga-instagram-overlay'),
                point = (m_currentPoint === null ? overlay.attr('point') : m_currentPoint);
            var item = mapData.data[point];
            m_this.map.getMap().transition({
                center: {
                    x: item[mapData.columns.longitude],
                    y: item[mapData.columns.latitude]
                },
                interp: d3.interpolateZoom,
                duration: 1000
            });
        };
    };

    inherit(geoapp.mapLayers[datainfo.key], geoapp.MapLayer);
};
