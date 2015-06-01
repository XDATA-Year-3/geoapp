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

geoapp.graphData = {};

geoapp.Graph = function (arg) {
    'use strict';

    if (!(this instanceof geoapp.Graph)) {
        return new geoapp.Graph(arg);
    }
    arg = arg || {};

    var m_this = this,
        m_view,
        m_numGraphs = 0,
        m_colorList = [
            '#d73027', '#4575b4', '#fdae61', '#abd9e9',
            '#f46d43', '#74add1', '#fee090', '#e0f3f8'
        ],
        m_navigableGraphOptions = ['type', 'bin', 'left', 'right'],
        m_graphInfo = {},
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
            tooltip: {
                contents: function (d, titleFormat, valueFormat, color) {
                    $(this.api.element).trigger('c3_tooltip', this.api.element,
                        titleFormat[d[0].x]);
                    return c3.chart.internal.fn.getTooltipContent.call(
                        this, d, titleFormat, valueFormat, color);
                },
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
                            /* When I was explciitly marking month starts,
                             * this was appropriate.
                            count: 13,
                             */
                            fit: false,
                            format: '%b %-d',
                            outer: false
                        },
                        type: 'timeseries'
                    }
                },
                data: { type: 'line' },
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
                data: { type: 'scatter' },
                point: { show: true }
            }
        };

    this.graphOpts = [];

    /* Bind graph events.
     *
     * @param view: the owner backbone view.
     */
    this.initialize = function (view) {
        m_view = view;
        $.extend(view.events, {
            'click .ga-add-graph': _.bind(this.addGraph, this),
            'click .ga-graph-settings': _.bind(this.graphSettings, this),
            'click .ga-remove-graph': _.bind(this.removeGraph, this)
        });
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
     */
    this.createGraph = function (position, series, opts, updateNav) {
        position = (position === null ? m_numGraphs : position);
        m_this.graphExists(position);

        opts = opts || {};
        this.graphOpts[position] = {
            position: position,
            series: series,
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
                spec.data.cols[xcol[0]] = spec.data.columns.length;
                spec.data.columns.push(xcol);
                m_this.graphOpts[position].xminmax = m_this.computeMinMax(
                    m_this.graphOpts[position].xminmax, xcol.slice(1));
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
                spec.axis.y = spec.axis.y || {};
                spec.axis.y.label = {
                    position: 'outer-middle',
                    text: spec.data.names[spec.data.columns[1][0]]
                };
                spec.legend = spec.legend || {};
                spec.legend.show = false;
            }
            this.graphOpts[position].c3 = c3.generate(spec);
            if (opts.left && opts.right) {
                this.graphOpts[position].c3.zoom(
                    [parseFloat(opts.left), parseFloat(opts.right)]);
            }
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
        dateRange.start = ((opts.dateRange && opts.dateRange.start) ?
            opts.dateRange.start : dateRange.start);
        dateRange.end = ((opts.dateRange && opts.dateRange.end) ?
            opts.dateRange.end : dateRange.end);
        spec.axis.x.min = dateRange.start;
        spec.axis.x.max = dateRange.end;
        /* I was explicitly marking the month starts, because it prevent some
         * format problems, but it caused others.
        if (moment(dateRange.end) - moment(dateRange.start) >
                moment.duration(2, moment.normalizeUnits('months'))) {
            var tickTime;

            spec.axis.x.tick.values = [];
            for (tickTime = moment.utc(dateRange.start).startOf('month');
                    tickTime < moment.utc(dateRange.end).startOf('month');
                    tickTime = tickTime.add(1, 'month')) {
                spec.axis.x.tick.values.push(0 + tickTime);
            }
        }
         */
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
            var i, j, k, x, idx;

            /* Insert the original data into the list and use the date as the
             * title of the tooltip. */
            for (i = 1; i < spec.data.columns[1].length; i += 1) {
                for (j = 0; j < d.length; j += 1) {
                    k = spec.data.cols[d[j].id];
                    /* Allow type coercion here */
                    /* jshint ignore:start */
                    if (d[j].value != spec.data.columns[k][i] ||
                            d[0].x != spec.data.columns[0][i]) {
                        break;
                    }
                    /* jshint ignore:end */
                }
                if (j === d.length) {
                    idx = i;
                    break;
                }
            }

            /* Insert the first data series so that the title will be the
             * date and the first data series will be in the list. */
            x = new Date(scatterDate[idx - 1]);
            d = d.slice();
            d.unshift({
                id: spec.data.columns[0][0],
                index: d[0].index,
                name: spec.data.names[spec.data.columns[0][0]],
                value: spec.data.columns[0][idx]
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
            _.each(dataSrc.available(), function (datakey) {
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
        var pos, opts, used = {}, update, old;

        _.each(settings, function (series, key) {
            if (key.substr(0, 6) === 'series') {
                series = series.split(',');
                opts = {};
                pos = parseInt(key.substr(6));
                old = m_this.graphOpts[pos];
                update = (!old || !_.isEqual(series, old.series));
                _.each(m_navigableGraphOptions, function (opt) {
                    opts[opt] = settings[opt + pos];
                    if (old) {
                        update = update || old.opts[opt] !== opts[opt];
                    }
                });
                if (update) {
                    m_this.createGraph(pos, series, opts, false);
                }
                used[pos] = true;
            }
        });
        for (pos = m_numGraphs - 1; pos >= 0; pos -= 1) {
            if (!used[pos]) {
                this.removeGraphs(undefined, pos);
            }
        }
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
        });
        if (update) {
            this.createGraph(position, opts.series, opts.opts, false);
        }
    };

    /* Process that a graph has been zoomed.  Save the zoom range to
     * navigation, and update the opts so that a data update won't affect the
     * range.
     *
     * @param c3graph: the c3 object that owns this graph.
     * @param range: the new x-axis range.
     */
    this.handleGraphZoom = function (c3graph, range) {
        var pos = parseInt($(c3graph.element).closest('[graph-position]').attr(
            'graph-position'));
        var graphOpts = m_this.graphOpts[pos];
        range = range.slice(); /* copy so we don't modify the calling object */
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
};

geoapp.graph = geoapp.Graph();


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
            graph.createGraph(position, series, opts, true);
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


/* -------- base data class -------- */

geoapp.GraphData = function (arg) {
    'use strict';

    if (!(this instanceof geoapp.GraphData)) {
        return new geoapp.GraphData(arg);
    }
    arg = arg || {};

    var m_updateTime = 0;

    this.dataItems = {};

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey) {
        return datakey ? false : [];
    };

    /* Based on a datakey, provide a description of the data.  name and
     * description keys are required.  There are optional keys:
     *  data: reserved for internal data buffering.
     *  dataTime: reserved for internal data buffering.
     *  sort: 0-based preferred sort order, lower sorts first.
     *  unit: unit to display after a value if exactly one.  Defaults to units.
     *  units: units to display after a value, if any.
     *
     * @param datakey: the data that is should be described.
     * @returns: a dictionary with at least 'name' and 'description' key values
     *           describing the specified data.
     */
    this.describe = function (datakey) {
        return this.dataItems[datakey];
    };

    /* Get the date range for the specific datakey.
     *
     * @param datakey: the data for which the date range is returned.
     * @param opts: options that may affect the date range returned.
     * @returns: the start (inclusive) and end (exclusive) date range for the
     *           data.
     */
    this.dateRange = function (datakey, opts) {
        var data = this.data(datakey, opts);
        return {
            start: 0 + moment.utc(data[0].x).startOf('day'),
            end: 0 + moment.utc(data[data.length - 1].x).subtract(
                1, 'ms').endOf('day').add(1, 'ms')
        };
    };

    /* Mark the data as updated, or return the last update time.
     *
     * @param update: if true, update the time to the current time.  If a
     *                number, set the time to the specified millisecond epoch,
     *                if undefined, just return the update time.
     * @return updateTime: the update time for the data.
     */
    this.dataTime = function (update) {
        if (update === true) {
            update = new Date().getTime();
        }
        if (update !== undefined) {
            m_updateTime = update;
        }
        return m_updateTime;
    };

    /* Given a start and end epoch and a text duration, generate bins where
     * each bin has a x value corresponding to its start epoch and a y value
     * of 0.
     *
     * @param start: the start epoch.
     * @param end: the end epoch.
     * @param duration: the text name of the duration of each bin (e.g.,
     *                  'hour', 'day', 'week', 'month'.
     * @returns: an object with the start and end forced to the exact start and
     *           end of a day or the duration, whichever is longer (possibly
     *           increasing the specified range), the created bins, and the
     *           duration interval in milliseconds (which won't make sense for
     *           the 'month' duration).
     */
    this.makeDateBins = function (start, end, duration) {
        var interval = 0 + moment.duration(1, moment.normalizeUnits(duration)),
            bins = [],
            i;
        start = 0 + moment.utc(start).startOf('day').startOf(duration);
        end = 0 + moment.utc(end).subtract(1, 'ms').endOf('day').endOf(
            'duration').add(1, 'ms');
        for (i = start; i < end; i = 0 + moment.utc(i).add(
                1, duration).startOf(duration)) {
            bins.push({x: i, y: 0});
        }
        return {start: start, end: end, bins: bins, interval: interval};
    };
};


geoapp.GraphDataFromColumns = function (arg, datakey) {
    'use strict';
    var m_datakey = datakey;

    if (!(this instanceof geoapp.GraphDataFromColumns)) {
        return new geoapp.GraphDataFromColumns(arg, datakey);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    geoapp.events.on('ga:dataLoaded.' + m_datakey, function () {
        this.dataTime(true);
        geoapp.graph.updateGraph();
    }, this);

    /* Given a datakey, return the associated data from an appropriate column.
     *
     * @param datakey: the datakey to retreive.
     * @param opts: options that may affect the date range returned.
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.data = function (datakey, opts) {
        var binName = 'data' + (opts.bin !== 'day' ? '-' + opts.bin : ''),
            data = geoapp.map.getLayer(m_datakey).data();
        if (this.dataItems[datakey][binName] && this.dataItems[datakey][
                binName + 'Time'] >= data.requestTime) {
            return this.dataItems[datakey][binName];
        }
        var dateRange = this.dateRange(datakey, opts),
            datecol = data.columns[this.dataItems[datakey].column],
            res = this.makeDateBins(dateRange.start, dateRange.end, opts.bin),

            start = res.start,
            end = res.end,
            bins = res.bins,
            interval = res.interval,
            numBins = bins.length;
        _.each(data.data, function (item) {
            var bin;
            if (opts.bin !== 'month') {
                bin = parseInt((item[datecol] - start) / interval);
            } else {
                if (item[datecol] < start) {
                    bin = -1;
                } else if (item[datecol] >= end) {
                    bin = numBins;
                } else {
                    for (bin = 0; bin < bins.length - 1; bin += 1) {
                        if (item[datecol] < bins[bin + 1].x) {
                            break;
                        }
                    }
                }
            }
            if (bin >= 0 && bin < numBins) {
                bins[bin].y += 1;
            }
        });
        if (this.dataItems[datakey].scaled) {
            /* Scale based on partial data and convert to log2 */
            if (data.loadFactor && data.loadFactor !== 1) {
                _.each(bins, function (d) {
                    d.y = parseInt(d.y / data.loadFactor);
                });
            }
            var log2 = Math.log(2);
            _.each(bins, function (d) {
                d.y = d.y ? Math.log(d.y) / log2 : 0;
            });
        }
        this.dataItems[datakey][binName] = bins;
        this.dataItems[datakey][binName + 'Time'] = new Date().getTime();
        return this.dataItems[datakey][binName];
    };

    /* Get the date range for the specific datakey.
     *
     * @param datakey: the data for which the date range is returned.
     * @param opts: options that may affect the date range returned.
     * @returns: the start (inclusive) and end (exclusive) date range for the
     *           data.
     */
    this.dateRange = function () {
        var layer = geoapp.map.getLayer(m_datakey),
            dateRange = layer.cycleDateRange();
        return {
            start: 0 + (dateRange.start || moment.utc('2013-1-1')),
            end: 0 + (dateRange.end || moment.utc('2014-1-1'))
        };
    };
};

inherit(geoapp.GraphDataFromColumns, geoapp.GraphData);

/* -------- weather graph data -------- */

geoapp.graphData.weather = function (arg) {
    'use strict';
    var m_datakey = 'weather';

    if (!(this instanceof geoapp.graphData[m_datakey])) {
        return new geoapp.graphData[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    this.dataItems = {
        temp_mean: {
            name: 'Avg. Temp',
            description: 'Mean temperature in degrees F',
            sort: 1,
            units: '&deg;F'
        },
        cloudcover: {
            name: 'Cloud Cover',
            description: 'Cloud cover value',
            exclude: true
        },
        fog: {
            name: 'Fog',
            description: 'Fog occurred',
            events: 'fog',
            collate: 'add'
        },
        precipitation: {
            name: 'Precipitation',
            description: 'Precipitation in inches',
            units: 'in',
            collate: 'add'
        },
        rain: {
            name: 'Rain',
            description: 'Rain occurred',
            events: 'rain',
            collate: 'add'
        },
        snow: {
            name: 'Snow',
            description: 'Snow occurred',
            events: 'snow',
            collate: 'add'
        },
        wind_gust: {
            name: 'Wind Gust',
            description: 'Gust speed in mph',
            units: 'mph',
            collate: 'max'
        },
        wind_max: {
            name: 'Wind Max',
            description: 'Max wind speed in mph',
            units: 'mph',
            collate: 'max'
        },
        wind_mean: {
            name: 'Wind',
            description: 'Mean wind speed in mph',
            units: 'mph'
        }
    };

    geoapp.events.on('ga:staticDataLoaded.' + m_datakey, function () {
        this.dataTime(true);
        geoapp.graph.updateGraph();
    }, this);

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey) {
        var data = geoapp.staticData ? geoapp.staticData[m_datakey] : null;
        if (!data) {
            return datakey ? false : [];
        }
        var avail = [];
        _.each(this.dataItems, function (item, key) {
            if (!item.exclude && (item.events ||
                   data.columns[key] !== undefined)) {
                avail.push(key);
            }
        });
        return datakey ? ($.inArray(datakey, avail) >= 0) : avail;
    };

    /* Given a datakey, return the associated data.
     *
     * @param datakey: the datakey to retreive.
     * @param opts: options that may affect the date range returned.
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.data = function (datakey, opts) {
        var binName = 'data' + (opts.bin !== 'day' ? '-' + opts.bin : ''),
            xcol, ycol, results = [],
            dataItem = this.dataItems[datakey];
        if (!dataItem.data) {
            var data = geoapp.staticData[m_datakey];
            xcol = data.columns.date_start;
            if (dataItem.events) {
                ycol = data.columns.events;
                _.each(data.data, function (d) {
                    results.push({
                        x: d[xcol],
                        y: d[ycol].toLowerCase().indexOf(
                            dataItem.events) >= 0 ? 1 : 0
                    });
                });
            } else {
                ycol = data.columns[datakey];
                _.each(data.data, function (d) {
                    results.push({x: d[xcol], y: d[ycol]});
                });
            }
            dataItem.data = results;
            dataItem.dataTime = new Date().getTime();
            dataItem.dataHourly = null;
        }
        if (opts.bin === 'day') {
            return dataItem.data;
        }
        if (!dataItem[binName]) {
            results = [];
            if (opts.bin === 'hour') {
                _.each(dataItem.data, function (d) {
                    for (var i = 0; i < 24; i += 1) {
                        results.push({x: d.x + i * 3600 * 1000, y: d.y});
                    }
                });
            } else {  /* week and month */
                var res = this.makeDateBins(dataItem.data[0].x, dataItem.data[dataItem.data.length - 1].x, opts.bin),
                    start = res.start,
                    end = res.end,
                    bins = res.bins,
                    interval = res.interval;
                _.each(dataItem.data, function (item) {
                    var bin;
                    if (item.x < start || item.x >= end) {
                        return;
                    }
                    if (opts.bin !== 'month') {
                        bin = parseInt((item.x - start) / interval);
                    } else {
                        for (bin = 0; bin < bins.length - 1; bin += 1) {
                            if (item.x < bins[bin + 1].x) {
                                break;
                            }
                        }
                    }
                    if (dataItem.collate === 'max') {
                        bins[bin].y = Math.max(bins[bin].y, item.y);
                    } else {
                        bins[bin].y += item.y;
                        bins[bin].count = (bins[bin].count || 0) + 1;
                    }
                });
                if (!dataItem.collate) {
                    _.each(bins, function (d) {
                        if (d.count) {
                            d.y /= d.count;
                        }
                    });
                }
                results = bins;
            }
            dataItem[binName] = results;
            dataItem[binName + 'Time'] = new Date().getTime();
        }
        return dataItem[binName];
    };

    /* Get the date range for the specific datakey.
     *
     * @param datakey: the data for which the date range is returned.
     * @param opts: options that may affect the date range returned.
     * @returns: the start (inclusive) and end (exclusive) date range for the
     *           data.
     */
    this.dateRange = function (datakey, opts) {
        var data = this.data(datakey, $.extend({}, opts, {bin: 'day'}));
        return {
            start: 0 + moment.utc(data[0].x).startOf('day'),
            end: 0 + moment.utc(data[data.length - 1].x).subtract(
                1, 'ms').endOf('day').add(1, 'ms')
        };
    };
};

inherit(geoapp.graphData.weather, geoapp.GraphData);
geoapp.graphData.weather = geoapp.graphData.weather();

/* -------- taxi model graph data -------- */

geoapp.graphData.taximodel = function (arg) {
    'use strict';
    var m_datakey = 'taximodel';

    if (!(this instanceof geoapp.graphData[m_datakey])) {
        return new geoapp.graphData[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    this.dataItems = {
        model: {
            name: 'Taxi - Typical Trips',
            description: 'Expected number of taxi trips under ordinary conditions (the seasonal and trend components of the modeled data)',
            units: 'log2(trips)'
        },
        remainder: {
            name: 'Taxi - Unusual Trips',
            description: 'Taxi trips that aren\'t part of regular behavior (the remainder component of the modeled data)',
            units: '&Delta;log2(trips)',
            column: 'remainder'
        },
        total: {
            name: 'Taxi - Total Trips',
            description: 'All taxi trips for the entire city (the raw component of the model)',
            units: 'log2(trips)',
            column: 'raw'
        }
    };

    geoapp.events.on('ga:staticDataLoaded.' + m_datakey, function () {
        this.dataTime(true);
        geoapp.graph.updateGraph();
    }, this);

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey) {
        var data = geoapp.staticData ? geoapp.staticData[m_datakey] : null;
        if (!data) {
            return datakey ? false : [];
        }
        var avail = _.keys(this.dataItems);
        return datakey ? ($.inArray(datakey, avail) >= 0) : avail;
    };

    /* Given a datakey, return the associated data.
     *
     * @param datakey: the datakey to retreive.
     * @param opts: options that may affect the date range returned.
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.data = function (datakey, opts) {
        if (opts.bin !== 'hour') {
            return this.dataGrouped(datakey, opts);
        }
        if (!this.dataItems[datakey].data) {
            var data = geoapp.staticData[m_datakey],
                xcol = data.columns.date,
                ycol,
                results = [];
            if (this.dataItems[datakey].column) {
                ycol = data.columns[this.dataItems[datakey].column];
            }
            _.each(data.data, function (d) {
                var item = { x: d[xcol] * 1000 },
                    value;
                if (!d[data.columns.raw]) {
                    return;
                }
                switch (datakey) {
                    case 'model':
                        value = (d[data.columns.seasonal] +
                            d[data.columns.trend]);
                        break;
                    default:
                        value = d[ycol];
                        break;
                }
                item.y = value; //Math.pow(2, value);
                results.push(item);
            });
            this.dataItems[datakey].data = results;
            this.dataItems[datakey].dataTime = new Date().getTime();
        }
        return this.dataItems[datakey].data;
    };

    /* Given a datakey, return the associated data collected to time interval
     * values.
     *
     * @param datakey: the datakey to retreive.
     * @param opts: options that may affect the date range returned.
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.dataGrouped = function (datakey, opts) {
        var binName = 'data-' + opts.bin,
            dataItem = this.dataItems[datakey];
        if (!dataItem[binName]) {
            var data = geoapp.staticData[m_datakey],
                xcol = data.columns.date,
                ycol,
                lastitem,
                results = [];
            if (dataItem.column) {
                ycol = data.columns[dataItem.column];
            }
            _.each(data.data, function (d) {
                var item = {
                        x: 0 + moment.utc(d[xcol] * 1000).startOf(opts.bin)
                    },
                    value;
                if (!d[data.columns.raw]) {
                    return;
                }
                switch (datakey) {
                    case 'model':
                        value = (d[data.columns.seasonal] +
                            d[data.columns.trend]);
                        break;
                    default:
                        value = d[ycol];
                        break;
                }
                item.y = value;
                if (lastitem && item.x === lastitem.x) {
                    lastitem.count += 1;
                    lastitem.tally += (datakey === 'remainder' ? item.y :
                        Math.pow(2, item.y));
                    if (lastitem.tally) {
                        lastitem.y = (datakey === 'remainder' ?
                            lastitem.tally / lastitem.count :
                            Math.log(lastitem.tally) / Math.log(2)).toFixed(4);
                    }
                } else {
                    results.push(item);
                    lastitem = item;
                    lastitem.count = 1;
                    lastitem.tally = (datakey === 'remainder' ? item.y :
                        Math.pow(2, item.y));
                }
            });
            dataItem[binName] = results;
            dataItem[binName + 'Time'] = new Date().getTime();
        }
        return dataItem[binName];
    };

    /* Get the date range for the specific datakey.
     *
     * @param datakey: the data for which the date range is returned.
     * @param opts: options that may affect the date range returned.
     * @returns: the start (inclusive) and end (exclusive) date range for the
     *           data.
     */
    this.dateRange = function (datakey, opts) {
        var data = this.data(datakey, $.extend({}, opts, {bin: 'hour'}));
        return {
            start: 0 + moment.utc(data[0].x).startOf('day'),
            end: 0 + moment.utc(data[data.length - 1].x).subtract(
                1, 'ms').endOf('day').add(1, 'ms')
        };
    };
};

inherit(geoapp.graphData.taximodel, geoapp.GraphData);
geoapp.graphData.taximodel = geoapp.graphData.taximodel();

/* -------- taxi graph data -------- */

geoapp.graphData.taxi = function (arg) {
    'use strict';
    var m_datakey = 'taxi';

    if (!(this instanceof geoapp.graphData[m_datakey])) {
        return new geoapp.graphData[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphDataFromColumns.call(this, arg, m_datakey);

    this.dataItems = {
        pickups: {
            name: 'Taxi Pickups',
            description: 'Filtered taxi pickups',
            column: 'pickup_datetime',
            unit: 'trip',
            units: 'trips'
        },
        dropoffs: {
            name: 'Taxi Dropoffs',
            description: 'Filtered taxi dropoffs',
            column: 'dropoff_datetime',
            unit: 'trip',
            units: 'trips'
        },
        scaledpickups: {
            name: 'Taxi Scaled Pickups',
            description: 'Filtered taxi pickups scaled to full data range',
            column: 'pickup_datetime',
            scaled: true,
            unit: 'trip',
            units: 'trips'
        },
        scaleddropoffs: {
            name: 'Taxi Scaled Dropoffs',
            description: 'Filtered taxi dropoffs scaled to full data range',
            column: 'dropoff_datetime',
            scaled: true,
            unit: 'trip',
            units: 'trips'
        }
    };

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey) {
        var data = geoapp.map.getLayer(m_datakey).data();
        if (!data || !data.columns || !data.data) {
            return datakey ? false : [];
        }
        return (datakey ? (this.dataItems[datakey] !== undefined) :
            _.keys(this.dataItems));
    };
};

inherit(geoapp.graphData.taxi, geoapp.GraphDataFromColumns);
geoapp.graphData.taxi = geoapp.graphData.taxi();

/* -------- instagram graph data -------- */

geoapp.graphData.instagram = function (arg) {
    'use strict';
    var m_datakey = 'instagram';

    if (!(this instanceof geoapp.graphData[m_datakey])) {
        return new geoapp.graphData[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphDataFromColumns.call(this, arg, m_datakey);

    this.dataItems = {
        messages: {
            name: 'Messages',
            description: 'Number of Instagram / Twitter messages',
            column: 'posted_date',
            sort: 0,
            unit: 'msg',
            units: 'msgs'
        }
    };

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey) {
        var data = geoapp.map.getLayer(m_datakey).data();
        if (!data || !data.columns || !data.data) {
            return datakey ? false : [];
        }
        return (datakey ? (this.dataItems[datakey] !== undefined) :
            _.keys(this.dataItems));
    };
};

inherit(geoapp.graphData.instagram, geoapp.GraphDataFromColumns);
geoapp.graphData.instagram = geoapp.graphData.instagram();
