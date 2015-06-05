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

geoapp.Graph = function (arg) {
    'use strict';

    if (!(this instanceof geoapp.Graph)) {
        return new geoapp.Graph(arg);
    }
    arg = arg || {};

    var m_this = this,
        m_maxScale = 365,
        m_view,
        m_updateGraphTimer = null,
        m_cycleDateRangeTime = 0,
        m_lastZoomRange,
        m_numGraphs = 0,
        m_colorList = [
            '#d73027', '#4575b4', '#fdae61', '#abd9e9',
            '#f46d43', '#74add1', '#fee090', '#e0f3f8'
        ],
        m_navigableGraphOptions = ['type', 'bin', 'left', 'right'],
        m_graphInfo = {},
        /* A simple time format would be '%b %-d' */
        m_timeFormat = d3.time.format.utc.multi([
            ['.%L', function (d) {
                return d.getUTCMilliseconds();
            }],
            [':%S', function (d) {
                return d.getUTCSeconds();
            }],
            ['%-H:%M', function (d) {
                return d.getUTCMinutes() || d.getUTCHours();
            }],
            ['%b %-d', function () {
                return true;
            }]
        ]),
        m_generalGraphSpec = {
            axis: {
                x: {
                    padding: { left: 0, right: 0}
                },
                y: {
                    padding: { top: 5, bottom: 0},
                    tick: {
                        fit: false,
                        format: function (x) {
                            return parseFloat((x).toFixed(4));
                        },
                        outer: false
                    }
                }
            },
            data: {
                onclick: function (evt) {
                    m_this.handleGraphClick(this, evt);
                }
            },
            padding: { left: 65 },
            tooltip: {
                format: {
                    value: function (value, ratio, id, index) {
                        index = index;  /* prevent unused warning */
                        var info = m_graphInfo[id.slice(1)];
                        if (!info || !info.desc) {
                            return value;
                        }
                        var unit = info.desc.units;
                        if (value === 1 && info.desc.unit !== undefined) {
                            unit = info.desc.unit;
                        }
                        return unit ? '' + value + ' ' + unit : value;
                    }
                }
            },
            zoom: {
                enabled: true,
                extent: [1, m_maxScale],
                onzoom: function (evt) {
                    $(this.element).trigger('c3_zoom', evt);
                },
                onzoomend: function (evt) {
                    $(this.element).trigger('c3_zoomend', evt);
                    m_this.handleGraphZoom(this, evt);
                },
                onzoomstart: function () {
                    $(this.element).trigger('c3_zoomstart');
                }
            }
        },
        m_defaultGraphSpec = {
            line : {
                axis: {
                    x: {
                        localtime: false,
                        tick: {
                            fit: false,
                            format: m_timeFormat,
                            outer: false
                        },
                        type: 'timeseries'
                    }
                },
                data: { type: 'step' },
                line: { step: { type: 'step-after' } },
                point: { show: false },
                subchart: {
                    onbrush: function (evt) {
                        $(this.element).trigger('c3_brush', evt);
                        m_this.handleGraphZoom(this, evt);
                    },
                    show: true,
                    size: { height: 20 }
                }
            },
            scatter: {
                axis: {
                    x: {
                        tick: {
                            fit: false,
                            format: function (x) {
                                return parseFloat((x).toFixed(4));
                            },
                            outer: false
                        }
                    }
                },
                data: {
                    type: 'scatter',
                    xLocalTime: false,
                    xSort: false
                },
                point: { show: true }
            }
        };

    this.graphOpts = {};

    /* Bind graph events.
     *
     * @param view: the owner backbone view.
     */
    this.initialize = function (view) {
        m_view = view;
        m_maxScale = ((moment.utc(geoapp.defaults.endDate) -
                       moment.utc(geoapp.defaults.startDate)) /
                      moment.duration(1, 'day'));
        $.extend(view.events, {
            'click .ga-add-graph': _.bind(this.addGraph, this),
            'click .ga-graph-settings': _.bind(this.graphSettings, this),
            'click .ga-remove-graph': _.bind(this.removeGraph, this),
            'click .ga-reset-graph': _.bind(this.resetGraph, this),
            'wheel .c3-brush': _.bind(this.zoomGraph, this)
        });
        geoapp.events.on('ga:cycleDateRange', function () {
            m_cycleDateRangeTime = new Date().getTime();
            m_this.updateGraphDelayed();
        });
    };

    /* Create the default graph(s).
     *
     * @return: a dictionary whose keys are the positions used for defaults.
     */
    this.createDefaultGraphs = function () {
        this.createGraph(0, ['internal.fullrange'], undefined, false, false);
        return {0: true};
    };

    /* Add a graph to our display.
     *
     * @param evt: the event that triggered this call.
     */
    this.addGraph = function () {
        var available = this.allAvailable();
        if (available.datasets.length) {
            this.createGraph(null, [available.datasets[0]]);
        }
    };

    /* Make sure the specified graph number exists.
     *
     * @param position: the 0-based graph position that must exist.  At least
     *                  (position + 1) graphs will be displayed.
     */
    this.graphExists = function (position) {
        $('#ga-graph .no-graph').css('display', 'none');
        var minimum = position + 1;
        while (m_numGraphs < minimum) {
            var pos = m_numGraphs,
                newGraph = $('#ga-graph #ga-graph-template').clone().attr({
                    id: 'ga-graph-' + pos,
                    'graph-position': pos
                }).removeClass('hidden');
            $('#ga-graph .panel-body').append(newGraph);
            /* Ensure we have associated data. */
            this.graphOpts[m_numGraphs] = {
                position: m_numGraphs,
                series: [],
                opts: {}
            };
            m_numGraphs += 1;
            $('#ga-graph-panel [title]').tooltip(geoapp.defaults.tooltip);
        }
    };

    /* Create or replace a graph.  The options can include:
     *  dateRange: {start: (starting epoch ms), end: (ending epoch ms)}
     *  type: 'line' or 'scatter'
     *  bin: 'hour', 'day', 'week', or 'month'
     *
     * @param position: 0 based graph position to update.  This ensures that
     *                  graph exists.  null to always create another graph.
     * @param series: an array of data series to plot.  Each entry is a period-
     *                delimited string of  "(data class).(data key)".  For
     *                example, "weather.temp_mean" is the mean daily
     *                temperature.  Only available data series are plotted.
     * @param opts: options dictionary for the graph.  See above.
     * @param updateNav: if not === false, update navigation.
     * @param useZoomRange: if not === false and this is a line graph, use
     *                      m_lastZoomRange for the zoom range.
     */
    this.createGraph = function (position, series, opts, updateNav,
                                 useZoomRange) {
        position = (position === null ? m_numGraphs : position);
        m_this.graphExists(position);

        opts = opts || {};
        this.graphOpts[position] = {
            position: position,
            series: series,
            usedSeries: {},
            opts: opts,
            xminmax: null
        };
        opts.type = m_defaultGraphSpec[opts.type] ? opts.type : 'line';
        opts.bin = $.inArray(opts.bin, ['month', 'week', 'day', 'hour']) >= 0 ?
            opts.bin : 'day';
        var dataPos = 1,
            dateRange,
            xScatter, xScatterCount, scatterDate = [],
            graphType = opts.type,
            missing = 0,
            spec = $.extend(true, {}, m_generalGraphSpec,
                m_defaultGraphSpec[graphType], {
                    bindto: '#ga-graph-' + position + ' .graph-plot',
                    data: {
                        colors: {},
                        columns: [],
                        names: {},
                        cols: {},
                        xs: {}
                    }
                });
        this.graphOpts[position].scatterDate = scatterDate;
        spec.tooltip.format.title = function (value) {
            var binFormat = {
                'month': '%b',
                'week': '%b %-d',
                'day': '%b %-d',
                'hour': '%b %-d %-H:%M'
            };
            return d3.time.format.utc(binFormat[opts.bin])(value);
        };
        _.each(series, function (seriesName) {
            var seriesInfo = seriesName.split('.'),
                srcName = seriesInfo[0],
                datakey = seriesInfo[1],
                dataSrc = geoapp.graphData[srcName];
            if (!dataSrc || !dataSrc.available(datakey)) {
                missing += 1;
                return;
            }
            var desc = dataSrc.describe(datakey),
                dr = dataSrc.dateRange(datakey, opts),
                seriesData = dataSrc.data(datakey, opts),
                graphkey = '' + position + '-' + dataPos,
                xcol = ['x' + graphkey],
                ycol = ['y' + graphkey];
            m_this.graphOpts[position].usedSeries[ycol] = {
                src: srcName,
                datakey: datakey
            };
            m_graphInfo[graphkey] = {
                desc: desc
            };
            if (!dateRange) {
                dateRange = dr;
            }
            dateRange.start = Math.min(dr.start, dateRange.start);
            dateRange.end = Math.max(dr.end, dateRange.end);
            spec.data.names[ycol[0]] = desc.name;
            if (graphType !== 'scatter') {
                _.each(seriesData, function (d) {
                    xcol.push(d.x);
                    ycol.push(d.y);
                });
                m_this.graphOpts[position].xminmax = m_this.computeMinMax(
                    m_this.graphOpts[position].xminmax, xcol.slice(1));
                /* Add an additional point so that the last step in our graph
                 * will look right. */
                if (seriesData.length >= 2) {
                    xcol.push(2 * seriesData[seriesData.length - 1].x -
                              seriesData[seriesData.length - 2].x);
                    ycol.push(seriesData[seriesData.length - 1].y);
                }
                spec.data.cols[xcol[0]] = spec.data.columns.length;
                spec.data.columns.push(xcol);
                spec.data.cols[ycol[0]] = spec.data.columns.length;
                spec.data.columns.push(ycol);
                spec.data.xs[ycol[0]] = xcol[0];
                spec.data.colors[ycol[0]] = m_colorList[dataPos - 1];
            } else {
                if (!xScatter) {
                    xScatter = {};
                    _.each(seriesData, function (d) {
                        if (d.x !== undefined && d.y !== undefined) {
                            xScatter[d.x] = ycol.length;
                            scatterDate.push(d.x);
                            ycol.push(d.y);
                        }
                    });
                    m_this.graphOpts[position].xminmax = m_this.computeMinMax(
                        null, ycol.slice(1));
                    xScatterCount = ycol.length;
                    spec.data.colors[ycol[0]] = 'rgba(0,0,0,0)';
                } else {
                    for (var i = ycol.length; i < xScatterCount; i += 1) {
                        ycol.push(null);
                    }
                    _.each(seriesData, function (d) {
                        if (xScatter[d.x] !== undefined) {
                            ycol[xScatter[d.x]] = d.y;
                        }
                    });
                    spec.data.colors[ycol[0]] = m_colorList[dataPos - 2];
                }
                spec.data.cols[ycol[0]] = spec.data.columns.length;
                spec.data.columns.push(ycol);
            }
            dataPos += 1;
        });
        $('#ga-graph-' + position).attr({'graph-series': series.join(' ')});
        $('#ga-graph-' + position + ' .graph-waiting').toggleClass(
            'hidden', missing === 0);
        $(spec.bindto).toggleClass('hidden', missing !== 0).css({
            width: $(spec.bindto).parent().innerWidth() + 'px',
            height: $(spec.bindto).parent().innerHeight() + 'px'
        });
        if (!missing) {
            var funcName = 'adjustGraph_' + graphType;
            if (this[funcName]) {
                this[funcName](spec, opts, dateRange || {}, scatterDate,
                m_this.graphOpts[position].xminmax);
            }
            if (spec.data.columns.length === 2) {
                if (spec.data.names[spec.data.columns[1][0]]) {
                    spec.axis.y = spec.axis.y || {};
                    spec.axis.y.label = {
                        position: 'outer-middle',
                        text: spec.data.names[spec.data.columns[1][0]]
                    };
                }
                spec.legend = spec.legend || {};
                spec.legend.show = false;
            }
            spec.transition = {duration: 0};
            this.graphOpts[position].c3 = c3.generate(spec);
            if (useZoomRange !== false && graphType === 'line') {
                opts.left = m_lastZoomRange ? m_lastZoomRange[0] : undefined;
                opts.right = m_lastZoomRange ? m_lastZoomRange[1] : undefined;
            }
            if (opts.left && opts.right) {
                this.graphOpts[position].c3.zoom(
                    [parseFloat(opts.left), parseFloat(opts.right)]);
            }
            /* Reset to the default transition */
            spec.transition = undefined;
            this.graphOpts[position].c3.internal.config
                .transition_duration = 350;
        }
        this.graphOpts[position].renderTime = (missing ? 0 :
            new Date().getTime());
        this.graphOpts[position].spec = spec;
        if (updateNav !== false) {
            this.updateGraphNavigation();
        }
    };

    /* Adjust the c3 specification for a line plot.
     *
     * @param spec: the c3 specification.  Modified.
     * @param opts: the graph options.
     * @param dateRange: the computed date range of the data.
     * @param scatterDate: an array of dates if this is a scatter plot.
     */
    this.adjustGraph_line = function (spec, opts, dateRange) {
        /* This code was to have each graph scale the date range to the data
         * on the graph.  It is no longer desired.
        dateRange.start = ((opts.dateRange && opts.dateRange.start) ?
            opts.dateRange.start : dateRange.start);
        dateRange.end = ((opts.dateRange && opts.dateRange.end) ?
            opts.dateRange.end : dateRange.end);
         */
        /* Always use the main date range, so that all graphs are the same.
         */
        dateRange = geoapp.map.getCycleDateRange();
        spec.axis.x.min = dateRange.start;
        spec.axis.x.max = dateRange.end;
        spec.tooltip.contents = function (d, titleFormat, valueFormat, color) {
            /* Trigger an event to indicate we are showing a tooltip */
            $(this.api.element).trigger('c3_tooltip', this.api.element,
                titleFormat[d[0].x]);
            var result = c3.chart.internal.fn.getTooltipContent.call(
                this, d, titleFormat, valueFormat, color);
            /* Don't show the tooltip when the point is outside of our range.
             * This prevents a tooltip on the 'extra' point that is added to
             * draw the last step.  We need to do this without sending back an
             * empty result, nor with using display: none, since this makes
             * other tooltips show oddly, as c3 dynamically tries to size them
             * and sometimes that fails. */
            if (d[0].x.getTime() >= 0 + dateRange.end) {
                result = $(result).css('visibility', 'hidden').wrap(
                    '<p>').parent().html();
            }
            return result;
        };
    };

    /* Adjust the c3 specification for a scatter plot.
     *
     * @param spec: the c3 specification.  Modified.
     * @param opts: the graph options.
     * @param dateRange: the computed date range of the data.
     * @param scatterDate: an array of dates if this is a scatter plot.
     * @param xminmax: the minimum and maximum x values for the whole graph.
     */
    this.adjustGraph_scatter = function (spec, opts, dateRange, scatterDate,
                                         xminmax) {
        var miny, maxy;

        spec.data.x = spec.data.columns[0][0];
        delete spec.data.xs;
        if (xminmax[0] !== 0) {
            spec.axis.x.padding.left = (xminmax[1] - xminmax[0]) * 0.01;
        }
        spec.axis.x.padding.right = (xminmax[1] - xminmax[0]) * 0.01;
        _.each(spec.data.columns.slice(1), function (data) {
            _.each(data.slice(1), function (y) {
                if (miny === undefined) {
                    miny = maxy = y;
                }
                miny = y < miny ? y : miny;
                maxy = y > maxy ? y : maxy;
            });
        });
        if (miny !== 0) {
            spec.axis.y.padding.bottom = 5;
        }
        spec.axis.x.label = {
            position: spec.data.columns.length === 2 ? 'outer-center' :
                'outer-right',
            text: spec.data.names[spec.data.columns[0][0]]
        };
        /* Use the tooltip contents function to call the c3 internal function.
         * This places all data series in the table and uses the data as the
         * title.  It is complex because c3 doesn't expose this in a nice
         * manner.
         */
        spec.tooltip.contents = function (d, titleFormat, valueFormat, color) {
            var i, x, idx;

            idx = d[0].index;
            /* Insert the first data series so that the title will be the
             * date and the first data series will be in the list. */
            x = new Date(scatterDate[idx]);
            d = d.slice();
            d.unshift({
                id: spec.data.columns[0][0],
                index: d[0].index,
                name: spec.data.names[spec.data.columns[0][0]],
                value: spec.data.columns[0][idx + 1]
            });
            for (i = 0; i < d.length; i += 1) {
                d[i] = $.extend({}, d[i], {x: x});
            }
            /* Trigger an event to indicate we are showing a tooltip */
            $(this.api.element).trigger('c3_tooltip', this.api.element,
                titleFormat[d[0].x]);
            return c3.chart.internal.fn.getTooltipContent.call(
                this, d, titleFormat, valueFormat, color);
        };
    };

    /* Remove a graph from our display.
     *
     * @param evt: the event that triggered this call.
     * @param position: if set and event is null or undefined, remove the graph
     *                  at the specified position.
     */
    this.removeGraph = function (evt, position) {
        if (evt) {
            position = parseInt($(evt.target).closest('.graph').attr(
                'graph-position'));
        }
        if (position >= m_numGraphs) {
            return;
        }
        $('#ga-graph-' + position).remove();
        for (var pos = position; pos < m_numGraphs - 1; pos += 1) {
            $('#ga-graph-' + (pos + 1)).attr({
                id: 'ga-graph-' + pos,
                'graph-position': pos
            });
            this.graphOpts[pos] = this.graphOpts[pos + 1];
        }
        delete this.graphOpts[m_numGraphs - 1];
        m_numGraphs -= 1;
        if (!m_numGraphs) {
            $('#ga-graph .no-graph').css('display', '');
        }
        this.updateGraphNavigation();
        this.checkZoomRange();
    };

    /* Clear the zoom range if there are no line plots.
     */
    this.checkZoomRange = function () {
        var i;
        for (i = 0; i < m_numGraphs; i += 1) {
            if (this.graphOpts[i].opts.type === 'line') {
                break;
            }
        }
        if (i >= m_numGraphs && m_lastZoomRange) {
            m_lastZoomRange = null;
            this.filterFromZoomRange();
            geoapp.events.trigger('ga:graphZoomRange', m_lastZoomRange);
        }
    };

    /* Apply a date filter to the map based on the current zoom range, but
     * limit the rate that this is performed.  Also flush all of the graphs to
     * make sure they are current.
     */
    this.filterFromZoomRange = function () {
        if (this._filterFromZoomRangeTimer) {
            this._filterFromZoomRangeAgain = true;
            return;
        }
        _.each(this.graphOpts, function (opts) {
            if (opts && opts.c3 && opts.c3.flush) {
                opts.c3.flush();
            }
        });
        var val = '';
        if (m_lastZoomRange && m_lastZoomRange[0] && m_lastZoomRange[1]) {
            var form = 'YYYY-MM-DD HH:mm:ss';
            val = (moment.utc(m_lastZoomRange[0]).format(form) + ' - ' +
                moment.utc(m_lastZoomRange[1]).format(form));
        }
        if (val !== $('#ga-display-date').val()) {
            $('#ga-display-date').val(val).trigger('change');
        }
        this._filterFromZoomRangeTimer = window.setTimeout(_.bind(function () {
            this._filterFromZoomRangeTimer = undefined;
            if (this._filterFromZoomRangeAgain) {
                this._filterFromZoomRangeAgain = false;
                this.filterFromZoomRange();
            }
        }, this), 250);
    };

    /* Change the settings for a graph.
     *
     * @param evt: the event that triggered this call.
     */
    this.graphSettings = function (evt) {
        var position = parseInt($(evt.target).closest('.graph').attr(
                'graph-position'));
        var widget = new geoapp.views.GraphSettingsWidget({
            el: $('#g-dialog-container'),
            position: position,
            graph: m_this,
            parentView: m_view
        });
        widget.render();
    };

    /* Get a list of all available data sets in the preferred order and a
     * dictionary of info about those dataset.
     *
     * @param series: a list of series currently in use.  Optional.
     * @param opts: a dictionar of options.  If datasetOrder is present, it is
     *              involved in sorting the results.  Optional.
     * @return: a dictionary with datasets (an ordered list of dataset keys),
     *          and datasetInfo, a dictionary of information about each
     *          dataset.
     */
    this.allAvailable = function (series, opts) {
        series = series || [];
        opts = opts || {};
        var datasets = [],
            datasetInfo = {};
        _.each(geoapp.graphData, function (dataSrc, srcName) {
            _.each(dataSrc.available(undefined, true), function (datakey) {
                var key = srcName + '.' + datakey;
                datasets.push(key);
                datasetInfo[key] = dataSrc.describe(datakey);
            });
        });
        /* Sort datasets so selected items are first and in order, then
         * previously sorted items, then by datasetInfo.sort, then by name. */
        datasets.sort(function (a, b) {
            var ina, inb;

            ina = $.inArray(a, series);
            inb = $.inArray(b, series);
            if (ina !== inb) {
                return ina === -1 ? 1 : (inb === -1 ? -1 : ina - inb);
            }
            if (opts.datasetOrder) {
                ina = $.inArray(a, opts.datasetOrder);
                inb = $.inArray(b, opts.datasetOrder);
                if (ina !== inb) {
                    return ina === -1 ? 1 : (inb === -1 ? -1 : ina - inb);
                }
            }
            ina = datasetInfo[a].sort !== undefined ? datasetInfo[a].sort : -1;
            inb = datasetInfo[b].sort !== undefined ? datasetInfo[b].sort : -1;
            if (ina !== inb) {
                return ina === -1 ? 1 : (inb === -1 ? -1 : ina - inb);
            }
            return datasetInfo[a].name > datasetInfo[b].name ? 1 : -1;
        });
        return {datasets: datasets, datasetInfo: datasetInfo};
    };

    /* Record the graphs that are being displayed in the navigation route.
     *
     * @param combine: if true and the last call to updateNavigation was the
     *                 same section, replace the previous navigation rather
     *                 than adding to the history.
     */
    this.updateGraphNavigation = function (combine) {
        var params = {};
        _.each(m_this.graphOpts, function (opts, pos) {
            params['series' + pos] = opts.series.join(',');
            _.each(m_navigableGraphOptions, function (opt) {
                if (opts.opts[opt] !== undefined) {
                    params[opt + pos] = opts.opts[opt];
                }
            });
        });
        geoapp.updateNavigation(undefined, 'graph', params, false, combine);
    };

    /* Based on the navigation route, replace existing graphs so that they are
     * what is listed in the route.
     *
     * @param settings: graph settings.
     */
    this.graphsFromNavigation = function (settings) {
        var pos, opts, used, update, old;

        used = this.createDefaultGraphs();
        m_lastZoomRange = null;
        _.each(settings, function (series, key) {
            if (key.substr(0, 6) === 'series') {
                pos = parseInt(key.substr(6));
                series = series.split(',');
                if (series.length === 1 && !series[0]) {
                    return;
                }
                opts = {};
                old = m_this.graphOpts[pos];
                update = (!old || !_.isEqual(series, old.series));
                _.each(m_navigableGraphOptions, function (opt) {
                    opts[opt] = settings[opt + pos];
                    if (old) {
                        update = update || old.opts[opt] !== opts[opt];
                    }
                });
                if (opts.type === 'line') {
                    if (!m_lastZoomRange) {
                        m_lastZoomRange = [
                            parseFloat(opts.left),
                            parseFloat(opts.right)
                        ];
                    } else {
                        opts.left = m_lastZoomRange[0];
                        opts.right = m_lastZoomRange[1];
                        update = (update || old.opts.left !== opts.left ||
                            old.opts.right !== opts.right);
                    }
                }
                if (update) {
                    m_this.createGraph(pos, series, opts, false, false);
                }
                used[pos] = true;
            }
        });
        for (pos = m_numGraphs - 1; pos >= 0; pos -= 1) {
            if (!used[pos]) {
                this.removeGraph(undefined, pos);
            }
        }
        this.filterFromZoomRange();
        geoapp.events.trigger('ga:graphZoomRange', m_lastZoomRange);
    };

    /* Update a graph with new data if necessary.  Graphs are only updated if
     * they were not rendered or the data timestamp is later than the render
     * timestamp or the always flag is true.
     *
     * @param position: the 0-based position of the graph, or undefined to
     *                  update all graphs.
     * @param always: if true, always update the graph.
     */
    this.updateGraph = function (position, always) {
        if (position === undefined) {
            if (m_updateGraphTimer) {
                window.clearTimeout(m_updateGraphTimer);
                m_updateGraphTimer = null;
            }
            for (position = 0; position < m_numGraphs; position += 1) {
                this.updateGraph(position, always);
            }
            return;
        }
        var opts = this.graphOpts[position],
            update = (always === true);
        _.each(opts.series, function (seriesName) {
            var seriesInfo = seriesName.split('.'),
                srcName = seriesInfo[0],
                dataSrc = geoapp.graphData[srcName];
            update = (update || (m_this.graphOpts[position].renderTime <
                dataSrc.dataTime()));
            update = (update || (m_this.graphOpts[position].renderTime <
                m_cycleDateRangeTime));
        });
        if (update) {
            this.createGraph(position, opts.series, opts.opts, false, false);
        }
    };

    /* Update the graph soon, but with a slight delay.  If we are already
     * waiting to update the graph, reset the timer so that the updates are
     * aggregated together and pushed back.
     */
    this.updateGraphDelayed = function () {
        if (m_updateGraphTimer) {
            window.clearTimeout(m_updateGraphTimer);
            m_updateGraphTimer = null;
        }
        m_updateGraphTimer = window.setTimeout(
            _.bind(m_this.updateGraph, m_this), 10);
    };

    /* Process that a graph has been zoomed.  Save the zoom range to
     * navigation, and update the opts so that a data update won't affect the
     * range.
     *
     * @param c3graph: the c3 object that owns this graph, or null for no
     *                 owner.
     * @param range: the new x-axis range.
     */
    this.handleGraphZoom = function (c3graph, range) {
        var pos = null, graphOpts, i;
        if (c3graph) {
            pos = parseInt($(c3graph.element).closest('[graph-position]').attr(
                'graph-position'));
            graphOpts = m_this.graphOpts[pos];
            /* copy range so we don't modify the calling object */
            range = range.slice();
            if (range[0].getTime) {
                range[0] = range[0].getTime();
                range[1] = range[1].getTime();
            }
            if (range[0] <= graphOpts.xminmax[0] &&
                    range[1] >= graphOpts.xminmax[1]) {
                range[0] = range[1] = undefined;
            }
            graphOpts.opts.left = range[0];
            graphOpts.opts.right = range[1];
        }
        if (pos === null || graphOpts.opts.type === 'line') {
            for (i = 0; i < m_numGraphs; i += 1) {
                if (i !== pos && m_this.graphOpts[i].opts.type === 'line') {
                    this.graphOpts[i].opts.left = range[0];
                    this.graphOpts[i].opts.right = range[1];
                    if ((!range[0] && !range[1]) ||
                            _.isEqual(range, this.graphOpts[i].xminmax)) {
                        this.graphOpts[i].c3.unzoom();
                    } else {
                        this.graphOpts[i].c3.zoom([
                            range[0] || this.graphOpts[i].xminmax[0],
                            range[1] || this.graphOpts[i].xminmax[1]
                        ]);
                    }
                }
            }
            m_lastZoomRange = range;
            this.filterFromZoomRange();
            geoapp.events.trigger('ga:graphZoomRange', m_lastZoomRange);
        }
        this.updateGraphNavigation(true);
    };

    /* Compute or extend the minimum and maximum values of an array.
     *
     * @param minmax: the existing [minimum, maximum] values to update.  This
     *                allows the total minimum and maximum of multiple arrays
     *                to be computer by passing the results from a previous
     *                call to this funcion (or nesting this function).  Null to
     *                just compute the minimum and maximum of the specified
     *                values.
     * @param values: an array of values.  If null or zero length, the min and
     *                max won't be adjusted.
     * @returns: [minimum, maximum], unless the values array was undefined or
     *           of zero length and minmax was null, in which case, null.
     */
    this.computeMinMax = function (minmax, values) {
        if (!values || !values.length) {
            return minmax;
        }
        if (!minmax) {
            minmax = [values[0], values[0]];
        }
        _.each(values, function (value) {
            if (value < minmax[0]) {
                minmax[0] = value;
            }
            if (value > minmax[1]) {
                minmax[1] = value;
            }
        });
        return minmax;
    };

    /* Zoom a graph based on a mouse wheel event within the subchart.
     *
     * @param evt: the event that triggered this call.
     */
    this.zoomGraph = function (evt) {
        var position = parseInt($(evt.currentTarget).closest('.graph').attr(
                'graph-position')),
            c3 = this.graphOpts[position].c3,
            minmax = [0 + c3.axis.min().x, 0 + c3.axis.max().x],
            pos = evt.originalEvent.pageX - $(evt.currentTarget).offset().left,
            width = $(evt.currentTarget)[0].getBBox().width,
            center = pos / width * (minmax[1] - minmax[0]) + minmax[0],
            curzoom = c3.zoom();
        curzoom[0] = 0 + moment.utc(curzoom[0]);
        curzoom[1] = 0 + moment.utc(curzoom[1]);
        if (curzoom[0] === curzoom[1]) {
            curzoom = minmax;
        }
        if (center < curzoom[0] || center > curzoom[1]) {
            center = (curzoom[1] + curzoom[0]) / 2;
        }
        var scale = Math.pow(2, evt.originalEvent.deltaY * 0.002);
        scale = Math.max(scale,
            (minmax[1] - minmax[0]) / (curzoom[1] - curzoom[0]) / m_maxScale);
        var newzoom = [
                parseInt((curzoom[0] - center) * scale + center),
                parseInt((curzoom[1] - center) * scale + center)
            ];
        if (newzoom[0] < minmax[0]) {
            newzoom[0] = minmax[0];
        }
        if (newzoom[1] > minmax[1]) {
            newzoom[1] = minmax[1];
        }
        if (_.isEqual(newzoom, minmax)) {
            c3.unzoom();
        } else if (!_.isEqual(newzoom, curzoom)) {
            c3.zoom(newzoom);
        }
        $(evt.currentTarget).trigger('c3_brush', newzoom);
        m_this.handleGraphZoom({element: evt.currentTarget}, newzoom);
    };

    /* Return the last zoom range.
     *
     * @return: the last zoom range.
     */
    this.getLastZoomRange = function () {
        return m_lastZoomRange;
    };

    /* Handle clicking on a point on a graph.
     *
     * @param c3graph: the c3 chart that owns this click.
     * @param d: the c3 object of the point that was clicked.
     */
    this.handleGraphClick = function (c3graph, d) {
        var pos = parseInt($(c3graph.element).closest('[graph-position]').attr(
                'graph-position')),
            graphOpts = this.graphOpts[pos],
            minmax = [0 + c3graph.axis.min().x, 0 + c3graph.axis.max().x],
            date, start, end;
        if (graphOpts.opts.type === 'scatter') {
            date = graphOpts.scatterDate[d.index];
        } else {
            date = d.x;
        }
        date = moment.utc(date);
        start = Math.max(0 + moment(date).startOf('day').startOf(
            graphOpts.opts.bin), minmax[0]);
        end = Math.min(0 + moment(date).endOf('day').endOf(
            graphOpts.opts.bin).add(1, 'ms'), minmax[1]);
        this.handleGraphZoom(undefined, [start, end]);
    };

    /* Reset the horizontal range of the selected graph.
     *
     * @param evt: the event that triggered this call.
     */
    this.resetGraph = function (evt) {
        var position = parseInt($(evt.currentTarget).closest('.graph').attr(
                'graph-position')),
            c3 = this.graphOpts[position].c3,
            newzoom = [0 + c3.axis.min().x, 0 + c3.axis.max().x];
        c3.unzoom();
        $(evt.currentTarget).trigger('c3_brush', newzoom);
        m_this.handleGraphZoom({element: evt.currentTarget}, newzoom);
    };
};

geoapp.graph = geoapp.Graph();


/* -------- override c3 -------- */

/* Override the default opacityForCircle function so we can alter the opacity
 * on our scatter plot */
var c3original_opacityForCircle = c3.chart.internal.fn.opacityForCircle;
c3.chart.internal.fn.opacityForCircle = function (d) {
    if (c3.chart.internal.fn.isScatterType.call(this, d)) {
        var position = parseInt(d.id.slice(1).split('-')[0]),
            graphOpts = geoapp.graph.graphOpts[position],
            range = geoapp.graph.getLastZoomRange(),
            date = graphOpts.scatterDate[d.index],
            show;
        if (!graphOpts || !range || !date || (!range[0] && !range[1])) {
            return c3original_opacityForCircle.apply(this, arguments);
        }
        show = ((!range[0] || date >= range[0]) &&
                (!range[1] || date < range[1]));
        return show ? 0.5 : 0.05;
    }
    return c3original_opacityForCircle.apply(this, arguments);
};

/* Override the default getScale to correct UTC issues. */
var c3original_getScale = c3.chart.internal.fn.getScale;
c3.chart.internal.fn.getScale = function (min, max, forTimeseries) {
    if (forTimeseries) {
        return this.d3.time.scale.utc().range([min, max]);
    }
    return c3original_getScale.apply(this, arguments);
};

/* Override the default tick density on the X axis.  The density of 7.125 is a
 * balance to have s sparse ticks as possible while still show 12 months on a
 * complete year. */
var c3original_getXAxis = c3.chart.internal.axis.fn.getXAxis;
c3.chart.internal.axis.fn.getXAxis = function () {
    var axis = c3original_getXAxis.apply(this, arguments);
    axis.ticks(7.125);
    return axis;
};

/* Override the default tick density on the Y axis.  The density of 6 seems
 * nice on our graph sizes. */
var c3original_getYAxis = c3.chart.internal.axis.fn.getYAxis;
c3.chart.internal.axis.fn.getYAxis = function () {
    var axis = c3original_getYAxis.apply(this, arguments);
    axis.ticks(6);
    return axis;
};


/* -------- Graph settings widget -------- */

geoapp.views.GraphSettingsWidget = geoapp.View.extend({
    events: {
        'click .ga-save-graph-settings': function () {
            var position = this.settings.position,
                graph = this.settings.graph,
                opts = graph.graphOpts[position].opts,
                series = graph.graphOpts[position].series;
            opts.type = $('.ga-graph-type .radio input:checked').attr(
                'graph-type') || opts.type || 'line';
            opts.bin = $('.ga-graph-bin .radio-inline input:checked').attr(
                'graph-bin') || opts.bin || 'hour';
            /* Clear previous zoom / subchart brush */
            opts.left = opts.right = undefined;
            opts.datasetOrder = [];
            series = [];
            $('#ga-dataset-list li').each(function () {
                var elem = $(this),
                    datakey = elem.attr('datakey');
                opts.datasetOrder.push(datakey);
                if ($('input[type="checkbox"]', elem).prop('checked')) {
                    series.push(datakey);
                }
            });
            if ((opts.type === 'line' && series.length < 1) ||
                    (opts.type === 'scatter' && series.length < 2)) {
                this.$('.g-validation-failed-message').text(
                    'You need to select at least ' + (
                    opts.type === 'line' ? '1 dataset' : '2 datasets') + '.');
                return;
            }
            graph.createGraph(position, series, opts, true, true);
            graph.checkZoomRange();
            this.$el.modal('hide');
        }
    },

    /* Initialize the widget.  The settings include:
     *  el: the container element for the widget.  Typically
     *      $('#g-dialog-container').
     *  position: the calling graph 0-based position.
     *  parentView: the graph object's view.
     *
     * @param settings: settings dictionary, as above.
     */
    initialize: function (settings) {
        this.settings = settings || {};
        this.viewName = 'GraphSettingsWidget';
    },

    /* Draw the dialog and populate the controls.
     */
    render: function () {
        var view = this,
            position = this.settings.position,
            graph = this.settings.graph,
            opts = graph.graphOpts[position].opts,
            series = graph.graphOpts[position].series,
            allAvail = graph.allAvailable(series, opts),
            datasets = allAvail.datasets,
            datasetInfo = allAvail.datasetInfo;
        var modal = this.$el.html(geoapp.templates.graphSettingsWidget({
            opts: opts,
            datasets: datasets,
            datasetInfo: datasetInfo,
            series: series
        })).girderModal(this).on('ready.geoapp.modal', function () {
            $('[title]', view.$el).tooltip(geoapp.defaults.tooltip);
            $('#ga-dataset-list', view.$el).sortable({});
        });
        modal.trigger($.Event('ready.geoapp.modal', {relatedTarget: modal}));
        geoapp.View.prototype.render.apply(this, arguments);
        return this;
    }
});
