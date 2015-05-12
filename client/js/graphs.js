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

geoapp.graph = {
    /* Add a graph to our display.
     *
     * @param evt: the event that triggered this call.
     */
    addGraph: function () {
        $('#ga-graph .no-graph').css('display', 'none');
        var newGraph = $('#ga-graph #ga-graph-template').clone().attr(
            'id', '').removeClass('hidden');
        $('#ga-graph .panel-body').append(newGraph);
        //DWM:: set some default data
    }
};

/* -------- base class -------- */

geoapp.GraphData = function (arg) {
    'use strict';

    if (!(this instanceof geoapp.GraphData)) {
        return new geoapp.GraphData(arg);
    }
    arg = arg || {};

    this.dataItems = {};

    /* List what data, if any, is available to be graphed.  This must be
     * overridden by a subclass.
     *
     * @returns: a list of available data keys.
     */
    this.available = function () {
        return [];
    };

    /* Based on a datakey, provide a short and long description of the data.
     *
     * @param datakey: the data that is should be described.
     * @returns: a dictionary with 'name' and 'desc' key values describing the
     *           specified data key.
     */
    this.describe = function (datakey) {
        return this.dataItems[datakey];
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
            name: 'Precip.',
            description: 'Daily precipitation in inches'
        },
        wind_mean: {
            name: 'Wind',
            description: 'Mean daily wind speed in mpg'
        }
    };

    /* List what data, if any, is available to be graphed.
     *
     * @returns: a list of available data keys.
     */
    this.available = function () {
        var data = geoapp.staticData.weather;
        if (!data) {
            return [];
        }
        var avail = [];
        _.each(this.dataItems, function (item, key) {
            if (data.columns[key] !== undefined && !item.exclude) {
                avail.push(key);
            }
        });
        return avail;
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

    var m_svg;

    this.create = function () {
        var selector = '#ga-graph-page .graph:last-of-type .graph-region',
            /* The margin must leave space for the axes */
            margin = {top: 5, right: 0, bottom: 18, left: 35},
            fullWidth = $(selector).width(),
            fullHeight = $(selector).height(),
            width = fullWidth - margin.left - margin.right,
            height = fullHeight - margin.top - margin.bottom,
            data = geoapp.staticData.weather;
        var svg = d3.select(selector).append('svg');
        svg = svg.append('g').attr(
            'transform', 'translate(' + margin.left + ',' + margin.top + ')');
        m_svg = svg;

        var x = d3.time.scale().range([0, width]);
        x.domain(d3.extent(data.data, function (d) {
            return d[data.columns.date_start];
        }));
        var xAxis = d3.svg.axis().scale(x).orient('bottom').tickSize(3, 0)
            .tickFormat(d3.time.format('%-m-%-d'));
        svg.append('g')
            .attr('class', 'x axis')
            .attr('transform', 'translate(0,' + height + ')')
            .call(xAxis);

        var items = {
            temp_mean:     {name: 'Avg. Temp',   color: '#d73027'},
            cloudcover:    {name: 'Cloud Cover', color: '#4575b4'},
            precipitation: {name: 'Precip.',     color: '#fdae61'},
            wind_mean:     {name: 'Wind',        color: '#74add1'}
        };
        /* colors: '#d73027','#f46d43','#fdae61','#fee090',
         *         '#e0f3f8','#abd9e9','#74add1','#4575b4' */
        var order = ['temp_mean', 'wind_mean', 'precipitation'];
        _.each(order, function (colname, colnum) {
            var item = items[colname],
                ycol = data.columns[colname];

            var y = d3.scale.linear().range([height, 0]);
            y.domain(d3.extent(data.data, function (d) {
                return d[ycol];
            }));
            var yAxis = d3.svg.axis().scale(y).orient('left').tickSize(3, 0)
                .ticks(3);
            svg.append('g')
                .attr({
                    'class': 'y axis',
                    'data-key': colname
                })
                .call(yAxis)
                .append('text')
                    .attr({
                        fill: item.color,
                        transform: 'rotate(-90)',
                        x: -fullHeight / (_.size(order) + 1) * colnum + margin.top,
                        y: -25
                    })
                    .style('text-anchor', 'end')
                    .text(item.name);
            $('svg [data-key="' + colname + '"] .tick', selector).css({
                fill: item.color
            });

            var line = d3.svg.line()
                .x(function (d) {
                    return x(d[data.columns.date_start]);
                })
                .y(function (d) {
                    return y(d[ycol]);
                });
            svg.append('path')
                .datum(data.data)
                .attr('class', 'line')
                .attr('d', line)
                .attr('stroke', item.color);
        });
    };

    this.add = function () {
        var data = geoapp.map.getLayer('instagram').data(),
            start = 0 + moment.utc('2013-1-1'),
            end = 0 + moment.utc('2014-1-1'),
            interval = 0 + moment.duration(1, moment.normalizeUnits('day')),
            datecol = data.columns.posted_date,
            bins = [],
            i, numBins;
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
        var svg = m_svg;

        var selector = '#ga-graph-page .graph:last-of-type .graph-region',
            /* The margin must leave space for the axes */
            margin = {top: 5, right: 0, bottom: 18, left: 35},
            fullWidth = $(selector).width(),
            fullHeight = $(selector).height(),
            width = fullWidth - margin.left - margin.right,
            height = fullHeight - margin.top - margin.bottom;
        var x = d3.time.scale().range([0, width]);
        x.domain(d3.extent(bins, function (d) {
            return d.x;
        }));
        var y = d3.scale.linear().range([height, 0]);
        y.domain(d3.extent(bins, function (d) {
            return d.y;
        }));
        var yAxis = d3.svg.axis().scale(y).orient('left').tickSize(3, 0)
            .ticks(3);
        svg.append('g')
            .attr({
                'class': 'y axis',
                'data-key': 'Messages'
            })
            .call(yAxis)
            .append('text')
                .attr({
                    fill: 'black',
                    transform: 'rotate(-90)',
                    x: -fullHeight / 4 * 3 + margin.top,
                    y: -25
                })
                .style('text-anchor', 'end')
                .text('Message');
        $('svg [data-key="msg"] .tick', selector).css({
            fill: 'black'
        });

        var line = d3.svg.line()
            .x(function (d) {
                return x(d.x);
            })
            .y(function (d) {
                return y(d.y);
            });
        svg.append('path')
            .datum(bins)
            .attr('class', 'line')
            .attr('d', line)
            .attr('stroke', 'black');
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
            description: 'Daily number of messages'
        }
        //DWM:: add hourly messages
    };

    /* List what data, if any, is available to be graphed.
     *
     * @returns: a list of available data keys.
     */
    this.available = function () {
        var data = geoapp.map.getLayer('instagram').data();
        if (!data || !data.columns || !data.data) {
            return [];
        }
        return _.keys(this.dataItems);
    };

    /* Given a datakey, return the associated data.
     *
     * @param datakey: the datakey to retreive.
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.data = function (datakey) {
        var layer = geoapp.map.getLayer('instagram'),
            data = layer.data();
        if (this.dataItems[datakey].data &&
                this.dataItems[datakey].dataTime >= data.requestTime) {
            return this.dataItems[datakey].data;
        }
        var dateRange = layer.cycleDateRange(),
            start = 0 + (dateRange.start || moment.utc('2013-1-1')),
            end = 0 + (dateRange.end || moment.utc('2014-1-1')),
            interval = 0 + moment.duration(1, moment.normalizeUnits('day')),
            datecol = data.columns.posted_date,
            bins = [],
            i, numBins;
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
        this.dataItems[datakey].data = bins;
        this.dataItems[datakey].dataTime = new Date().getTime();
        return this.dataItems[datakey].data;
    };
};

inherit(geoapp.graphData.instagram, geoapp.GraphData);
geoapp.graphData.instagram = geoapp.graphData.instagram();
