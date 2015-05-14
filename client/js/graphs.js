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
            zoom: { enabled: true }
        },
        m_defaultGraphSpec = {
            line : {
                axis: {
                    x: {
                        localtime: false,
                        tick: {
                            count: 13,
                            fit: false,
                            format: '%-m-%-d',
                            outer: false
                        },
                        type: 'timeseries'
                    }
                },
                data: { type: 'line' },
                point: { show: false },
                subchart: {
                    show: true,
                    size: { height: 25 }
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
     *  bin: 'day' or 'hour'
     *
     * @param position: 0 based graph position to update.  This ensures that
     *                  graph exists.  null to always create another graph.
     * @param series: an array of data series to plot.  Each entry is a period-
     *                delimited string of  "(data class).(data key)".  For
     *                example, "weather.temp_mean" is the mean daily
     *                temperature.  Only available data series are plotted.
     * @param opts: options dictionary for the graph.  See above.
     */
    this.createGraph = function (position, series, opts) {
        position = (position === null ? m_numGraphs : position);
        m_this.graphExists(position);

        opts = opts || {};
        this.graphOpts[position] = {
            position: position,
            series: series,
            opts: opts
        };
        opts.type = m_defaultGraphSpec[opts.type] ? opts.type : 'line';
        opts.bin = $.inArray(opts.bin, ['day', 'hour']) >= 0 ? opts.bin : 'day';
        var dataPos = 1,
            dateRange,
            xScatter, xScatterCount,
            graphType = opts.type,
            spec = $.extend(true, {}, m_generalGraphSpec,
                m_defaultGraphSpec[graphType], {
                    bindto: '#ga-graph-' + position + ' .graph-region',
                    data: {
                        colors: {},
                        columns: [],
                        names: {},
                        xs: {}
                    }
                });
        _.each(series, function (seriesName) {
            var seriesInfo = seriesName.split('.'),
                srcName = seriesInfo[0],
                datakey = seriesInfo[1],
                dataSrc = geoapp.graphData[srcName];
            if (!dataSrc || !dataSrc.available(datakey)) {
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
            spec.data.colors[ycol[0]] = m_colorList[dataPos - 1];
            if (graphType !== 'scatter') {
                _.each(seriesData, function (d) {
                    xcol.push(d.x);
                    ycol.push(d.y);
                });
                spec.data.columns.push(ycol);
                spec.data.columns.push(xcol);
                spec.data.xs[ycol[0]] = xcol[0];
            } else {
                if (!xScatter) {
                    xScatter = {};
                    _.each(seriesData, function (d) {
                        if (d.x !== undefined && d.y !== undefined) {
                            xScatter[d.x] = ycol.length;
                            ycol.push(d.y);
                        }
                    });
                    xScatterCount = ycol.length;
                } else {
                    for (var i = ycol.length; i < xScatterCount; i += 1) {
                        ycol.push(null);
                    }
                    _.each(seriesData, function (d) {
                        if (xScatter[d.x] !== undefined) {
                            ycol[xScatter[d.x]] = d.y;
                        }
                    });
                }
                spec.data.columns.push(ycol);
            }
            dataPos += 1;
        });
        var funcName = 'adjustGraph_' + graphType;
        if (this[funcName]) {
            this[funcName](spec, opts, dateRange);
        }
        c3.generate(spec);
        this.graphOpts[position].spec = spec;
        //DWM:: record nav
    };

    /* Adjust the c3 specification for a line plot.
     *
     * @param spec: the c3 specification.  Modified.
     * @param opts: the graph options.
     * @param dateRange: the computer date range of the data.
     */
    this.adjustGraph_line = function (spec, opts, dateRange) {
        var tickTime;

        dateRange.start = ((opts.dateRange && opts.dateRange.start) ?
            opts.dateRange.start : dateRange.start);
        dateRange.end = ((opts.dateRange && opts.dateRange.end) ?
            opts.dateRange.end : dateRange.end);
        spec.axis.x.min = dateRange.start;
        spec.axis.x.max = dateRange.end;
        if (moment(dateRange.end) - moment(dateRange.start) >
                moment.duration(2, moment.normalizeUnits('months'))) {
            spec.axis.x.tick.values = [];
            for (tickTime = moment.utc(dateRange.start).startOf('month');
                    tickTime < moment.utc(dateRange.end).startOf('month');
                    tickTime = tickTime.add(1, 'month')) {
                spec.axis.x.tick.values.push(0 + tickTime);
            }
        }
    };

    /* Adjust the c3 specification for a scatter plot.
     *
     * @param spec: the c3 specification.  Modified.
     * @param opts: the graph options.
     * @param dateRange: the computer date range of the data.
     */
    this.adjustGraph_scatter = function (spec) {
        var minx, maxx, miny, maxy;

        spec.data.x = spec.data.columns[0][0];
        delete spec.data.xs;
        /* Add a bit of padding to the x and y direcctions.  Padding is in
         * pixels vertically and in teh data domain horizontally. */
        _.each(spec.data.columns[0].slice(1), function (x) {
            if (minx === undefined) {
                minx = maxx = x;
            }
            minx = x < minx ? x : minx;
            maxx = x > maxx ? x : maxx;
        });
        if (minx !== 0) {
            spec.axis.x.padding.left = (maxx - minx) * 0.005;
        }
        spec.axis.x.padding.right = (maxx - minx) * 0.005;
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
            position: 'outer-center',
            text: spec.data.names[spec.data.columns[0][0]]
        };
        if (spec.data.columns.length === 2) {
            spec.axis.y = spec.axis.y || {};
            spec.axis.y.label = {
                position: 'outer-middle',
                text: spec.data.names[spec.data.columns[1][0]]
            };
            spec.legend = spec.legend || {};
            spec.legend.show = false;
        } else {
            spec.axis.x.label.position = 'outer-right';
        }
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
        //DWM:: record nav
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
            graph.createGraph(position, series, opts);
            //DWM:: record nav
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
            $('[title]', view.$el).tooltip({delay: {show: 500}});
            $('#ga-dataset-list', view.$el).sortable({});
        });
        modal.trigger($.Event('ready.geoapp.modal', {relatedTarget: modal}));
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
        var data = this.data(datakey, opts),
            day = 0 + moment.duration(1, moment.normalizeUnits('day'));
        return {
            start: Math.floor(data[0].x / day) * day,
            end: Math.ceil((data[data.length - 1].x + 1.0) / day) * day
        };
    };
};

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
            sort: 0,
            units: '&deg;F'
        },
        cloudcover: {
            name: 'Cloud Cover',
            description: 'Cloud cover value'
        },
        precipitation: {
            name: 'Precipitation',
            description: 'Precipitation in inches',
            units: 'in'
        },
        wind_gust: {
            name: 'Wind Gust',
            description: 'Gust speed in mph',
            units: 'mph'
        },
        wind_max: {
            name: 'Wind Max',
            description: 'Max wind speed in mph',
            units: 'mph'
        },
        wind_mean: {
            name: 'Wind',
            description: 'Mean wind speed in mph',
            units: 'mph'
        }
    };

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
            if (data.columns[key] !== undefined && !item.exclude) {
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
        var xcol, ycol, results = [];
        if (!this.dataItems[datakey].data) {
            var data = geoapp.staticData[m_datakey];
            xcol = data.columns.date_start;
            ycol = data.columns[datakey];
            _.each(data.data, function (d) {
                results.push({x: d[xcol], y: d[ycol]});
            });
            this.dataItems[datakey].data = results;
            this.dataItems[datakey].dataTime = new Date().getTime();
            this.dataItems[datakey].dataHourly = null;
        }
        if (opts.bin === 'day') {
            return this.dataItems[datakey].data;
        }
        if (!this.dataItems[datakey].dataHourly) {
            results = [];
            _.each(this.dataItems[datakey].data, function (d) {
                for (var i = 0; i < 24; i += 1) {
                    results.push({x: d.x + i * 3600 * 1000, y: d.y});
                }
            });
            this.dataItems[datakey].dataHourly = results;
            this.dataItems[datakey].dataHourlyTime = new Date().getTime();
        }
        return this.dataItems[datakey].dataHourly;
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
        if (opts.bin === 'day') {
            return this.dataDaily(datakey);
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

    /* Given a datakey, return the associated data collected to daily values.
     *
     * @param datakey: the datakey to retreive.
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.dataDaily = function (datakey) {
        if (!this.dataItems[datakey].dataDaily) {
            var data = geoapp.staticData[m_datakey],
                xcol = data.columns.date,
                ycol,
                lastitem,
                results = [];
            if (this.dataItems[datakey].column) {
                ycol = data.columns[this.dataItems[datakey].column];
            }
            _.each(data.data, function (d) {
                var item = { x: 0 + moment.utc(d[xcol] * 1000).startOf('day') },
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
            this.dataItems[datakey].dataDaily = results;
            this.dataItems[datakey].dataDailyTime = new Date().getTime();
        }
        return this.dataItems[datakey].dataDaily;
    };
};

inherit(geoapp.graphData.taximodel, geoapp.GraphData);
geoapp.graphData.taximodel = geoapp.graphData.taximodel();

/* -------- instagram graph data -------- */

geoapp.graphData.instagram = function (arg) {
    'use strict';
    var m_datakey = 'instagram';

    if (!(this instanceof geoapp.graphData[m_datakey])) {
        return new geoapp.graphData[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    this.dataItems = {
        messages: {
            name: 'Instagram Messages',
            description: 'Number of Instagram messages',
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
        var data = geoapp.map.getLayer('instagram').data();
        if (!data || !data.columns || !data.data) {
            return datakey ? false : [];
        }
        return (datakey ? (this.dataItems[datakey] !== undefined) :
            _.keys(this.dataItems));
    };

    /* Given a datakey, return the associated data.
     *
     * @param datakey: the datakey to retreive.
     * @param opts: options that may affect the date range returned.
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.data = function (datakey, opts) {
        var binName = opts.bin === 'day' ? 'dataHourly' : 'data',
            data = geoapp.map.getLayer('instagram').data();
        if (this.dataItems[datakey][binName] && this.dataItems[datakey][
                binName + 'Time'] >= data.requestTime) {
            return this.dataItems[datakey][binName];
        }
        var dateRange = this.dateRange(datakey, opts),
            start = dateRange.start,
            end = dateRange.end,
            interval = 0 + moment.duration(1, moment.normalizeUnits(opts.bin)),
            datecol = data.columns.posted_date,
            bins = [],
            i, numBins;
        start = 0 + moment.utc(start).startOf('day');
        end = 0 + moment.utc(end - 1).startOf('day').add(1, 'day');
        for (i = start; i < end; i += interval) {
            bins.push({x: i, y: 0});
        }
        numBins = bins.length;
        _.each(data.data, function (item) {
            var bin = parseInt((item[datecol] - start) / interval);
            if (bin >= 0 && bin < numBins) {
                bins[bin].y += 1;
            }
        });
        /* Scale based on partial data.
        if (data.loadFactor && data.loadFactor !== 1) {
            _.each(bins, function (d) {
                d.y = parseInt(d.y / data.loadFactor);
            });
        }
         */
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
        var layer = geoapp.map.getLayer('instagram'),
            dateRange = layer.cycleDateRange();
        return {
            start: 0 + (dateRange.start || moment.utc('2013-1-1')),
            end: 0 + (dateRange.end || moment.utc('2014-1-1'))
        };
    };
};

inherit(geoapp.graphData.instagram, geoapp.GraphData);
geoapp.graphData.instagram = geoapp.graphData.instagram();
