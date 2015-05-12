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
        m_defaultGraphSpec = {
            line : {
                axis: {
                    x: {
                        localtime: false,
                        padding: { left: 0, right: 1},
                        tick: {
                            count: 13,
                            fit: false,
                            format: '%-m-%-d',
                            outer: false
                        },
                        type: 'timeseries'
                    },
                    y: {
                        padding: { top: 0, bottom: 0},
                        tick: {
                            fit: false,
                            outer: false
                        }
                    }
                },
                data: { type: 'line' },
                point: { show: false },
                zoom: { enabled: true }
            },
            scatter: {
                axis: {
                    x: {
                        padding: { left: 0, right: 1},
                        tick: {
                            fit: false,
                            outer: false
                        }
                    },
                    y: {
                        padding: { top: 0, bottom: 0},
                        tick: {
                            fit: false,
                            outer: false
                        }
                    }
                },
                data: { type: 'scatter' },
                point: { show: true },
                zoom: { enabled: true }
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
     * @param minimum: if specified, make sure that there are at least this
     *                 many graphs being displayed.
     */
    this.addGraph = function (evt, minimum) {
        $('#ga-graph .no-graph').css('display', 'none');
        if (!minimum) {
            minimum = m_numGraphs + 1;
        }
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
            /* Set some default data if this is an event. */
            if (evt) {
                this.createGraph(m_numGraphs - 1, ['weather.temp_mean']);
            }
        }
    };

    /* Create or replace a graph.  The options can include:
     *  dateRange: {start: (starting epoch ms), end: (ending epoch ms)}
     *  type: 'line' or 'scatter'
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
        position = (position === null ? m_numGraphs + 1 : position);
        m_this.addGraph(null, position + 1);

        opts = opts || {};
        this.graphOpts[position] = {
            position: position,
            series: series,
            opts: opts
        };
        opts.type = m_defaultGraphSpec[opts.type] ? opts.type : 'line';
        var dataPos = 1,
            dateRange,
            tickTime,
            graphType = opts.type,
            spec = $.extend(true, {}, m_defaultGraphSpec[graphType], {
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
                dr = dataSrc.dateRange(datakey),
                seriesData = dataSrc.data(datakey),
                xcol = ['x' + dataPos],
                ycol = ['y' + dataPos];
            if (!dateRange) {
                dateRange = dr;
            }
            dateRange.start = Math.min(dr.start, dateRange.start);
            dateRange.end = Math.max(dr.end, dateRange.end);
            spec.data.names[ycol[0]] = desc.name;
            spec.data.colors[ycol[0]] = m_colorList[dataPos - 1];
            _.each(seriesData, function (d) {
                xcol.push(d.x);
                ycol.push(d.y);
            });
            spec.data.columns.push(ycol);
            if (graphType !== 'scatter') {
                spec.data.columns.push(xcol);
                spec.data.xs[ycol[0]] = xcol[0];
            }
            dataPos += 1;
        });
        if (graphType !== 'scatter') {
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
        } else {
            /* scatterplot */
            spec.data.x = spec.data.columns[0][0];
            delete spec.data.xs;
        }
        c3.generate(spec);
        this.graphOpts[position].spec = spec;
        //DWM:: record nav
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
                'graph-type') || opts.type;
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
            graph.createGraph(position, series, opts);
            //DWM:: record nav
            return false;
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
            datasets = [],
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
        var modal = this.$el.html(geoapp.templates.graphSettingsWidget({
            opts: opts,
            datasets: datasets,
            datasetInfo: datasetInfo,
            series: series
        })).girderModal(this).on('ready.geoapp.modal', function () {
            console.log(view.$el);
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
     * @returns: the start (inclusive) and end (exclusive) date range for the
     *           data.
     */
    this.dateRange = function (datakey) {
        var data = this.data(datakey),
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
    var datakey = 'weather';

    if (!(this instanceof geoapp.graphData[datakey])) {
        return new geoapp.graphData[datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    this.dataItems = {
        temp_mean: {
            name: 'Avg. Temp',
            description: 'Mean daily temperature in degrees F'
        },
        cloudcover: {
            name: 'Cloud Cover',
            description: 'Daily cloud cover value'
        },
        precipitation: {
            name: 'Precipitation',
            description: 'Daily precipitation in inches'
        },
        wind_gust: {
            name: 'Wind Gust',
            description: 'Daily gust speed in mph'
        },
        wind_max: {
            name: 'Wind Max',
            description: 'Max daily wind speed in mph'
        },
        wind_mean: {
            name: 'Wind',
            description: 'Mean daily wind speed in mph',
            sort: 0
        }
    };

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey) {
        var data = geoapp.staticData.weather;
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
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.data = function (datakey) {
        if (!this.dataItems[datakey].data) {
            var data = geoapp.staticData.weather,
                xcol = data.columns.date_start,
                ycol = data.columns[datakey],
                results = [];
            _.each(data.data, function (d) {
                results.push({x: d[xcol], y: d[ycol]});
            });
            this.dataItems[datakey].data = results;
            this.dataItems[datakey].dataTime = new Date().getTime();
        }
        return this.dataItems[datakey].data;
    };
};

inherit(geoapp.graphData.weather, geoapp.GraphData);
geoapp.graphData.weather = geoapp.graphData.weather();

/* -------- instagram graph data -------- */

geoapp.graphData.instagram = function (arg) {
    'use strict';
    var datakey = 'instagram';

    if (!(this instanceof geoapp.graphData[datakey])) {
        return new geoapp.graphData[datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    this.dataItems = {
        messages: {
            name: 'Messages',
            description: 'Daily number of Instagram messages'
        }
        //DWM:: add hourly messages
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
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.data = function (datakey) {
        var data = geoapp.map.getLayer('instagram').data();
        if (this.dataItems[datakey].data &&
                this.dataItems[datakey].dataTime >= data.requestTime) {
            return this.dataItems[datakey].data;
        }
        var dateRange = this.dateRange(datakey),
            start = dateRange.start,
            end = dateRange.end,
            interval = 0 + moment.duration(1, moment.normalizeUnits('day')),
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
        this.dataItems[datakey].data = bins;
        this.dataItems[datakey].dataTime = new Date().getTime();
        return this.dataItems[datakey].data;
    };

    /* Get the date range for the specific datakey.
     *
     * @param datakey: the data for which the date range is returned.
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
