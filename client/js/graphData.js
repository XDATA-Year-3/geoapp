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
geoapp.graphDataClasses = {};

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
     *  axisunits: if present, use this value for the axis or line labels.  If
     *      null, no units units on the axis label.  Defaults to units.
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
            bins.push({
                x: i,
                y: 0,
                duration: moment.utc(i).add(1, duration).startOf(duration) - i
            });
        }
        return {start: start, end: end, bins: bins, interval: interval};
    };

    /* Convert a log2 number to a natural number.
     *
     * @param d: the number to convert.  0 is treated as a special case, and
     *           0 is returned (not 1).
     * @returns: the converted number.
     */
    this.unlog2 = function (d) {
        return d ? Math.pow(2, d).toFixed(0) : 0;
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
        geoapp.graph.updateGraphDelayed();
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
            /* Scale based on partial data, convert to hourly, then to log2 */
            if (data.loadFactor && data.loadFactor !== 1) {
                _.each(bins, function (d) {
                    d.y = d.y / data.loadFactor;
                });
            }
            var log2 = Math.log(2), hour = 0 + moment.duration(1, 'hour');
            _.each(bins, function (d) {
                d.y = (d.y ? Math.log(d.y * hour / d.duration) / log2 : 0
                    ).toFixed(4);
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

/* -------- internal graph data -------- */

geoapp.graphData.internal = function (arg) {
    'use strict';
    var m_datakey = 'internal';

    if (!(this instanceof geoapp.graphData[m_datakey])) {
        return new geoapp.graphData[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    this.dataItems = {
        fullrange: {
            name: '',
            description: 'Full date range for all data'
        }
    };

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @param forUser: true if this is to show the user, falsy for internal
     *                 use.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey, forUser) {
        var avail = forUser ? [] : _.keys(this.dataItems);
        return datakey ? ($.inArray(datakey, avail) >= 0) : avail;
    };

    /* Given a datakey, return the associated data.
     *
     * @param datakey: the datakey to retreive.
     * @param opts: options that may affect the date range returned.
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.data = function () {
        var range = geoapp.map.getCycleDateRange();
        return [{x: 0 + range.start, y: 0}, {x: 0 + range.end, y: 0}];
    };
};

inherit(geoapp.graphData.internal, geoapp.GraphData);
geoapp.graphData.internal = geoapp.graphData.internal();

/* -------- weather graph data -------- */

geoapp.graphDataClasses.weather = function (arg) {
    'use strict';
    var m_datakey = 'weather';

    if (!(this instanceof geoapp.graphDataClasses[m_datakey])) {
        return new geoapp.graphDataClasses[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    if (arg.name) {
        m_datakey = arg.name;
    }
    var m_options = arg;

    this.dataItems = {
        temp_mean: {
            name: 'Avg. Temp',
            longname: 'Average Temperature',
            description: 'Mean temperature in degrees F',
            sort: 1,
            units: '\u00B0F'
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
            longname: 'Precipitation (inches)',
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
        thunder: {
            regions: ['boston'],
            name: 'Thunder',
            description: 'Thunder occurred',
            events: 'thunder',
            collate: 'add'
        },
        wind_gust: {
            name: 'Wind Gust',
            longname: 'Wind Gust Speed (mph)',
            description: 'Gust speed in mph',
            units: 'mph',
            collate: 'max',
            exclude: true
        },
        wind_max: {
            name: 'Wind Max',
            longname: 'Wind Maximum Speed (mph)',
            description: 'Max wind speed in mph',
            units: 'mph',
            collate: 'max',
            exclude: true
        },
        wind_mean: {
            name: 'Wind',
            longname: 'Wind Average Speed (mph)',
            description: 'Mean wind speed in mph',
            units: 'mph',
            exclude: true
        }
    };

    _.each(this.dataItems, function (item) {
        if (m_options.region_name) {
            item.longname = 'Weather - ' + m_options.region_name + ' - ' + (
                item.longname || item.name);
        }
        if (m_options.region_shortname) {
            item.name = m_options.region_shortname + ' - ' + item.name;
        }
        if (item.regions && $.inArray(m_options.region, item.regions) < 0) {
            item.exclude = true;
        }
    });

    geoapp.events.on('ga:staticDataLoaded.' + m_datakey, function () {
        this.dataTime(true);
        geoapp.graph.updateGraphDelayed();
    }, this);

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey) {
        var data = geoapp.staticData ? geoapp.staticData[m_datakey] : null;
        if (!data || !data.columns || !data.data) {
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
                var res = this.makeDateBins(dataItem.data[0].x,
                        dataItem.data[dataItem.data.length - 1].x, opts.bin),
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

inherit(geoapp.graphDataClasses.weather, geoapp.GraphData);

geoapp.graphData.weathernyc = geoapp.graphDataClasses.weather({
    name: 'weathernyc',
    region: 'nyc',
    region_name: 'NYC',
    region_shortname: 'NYC'
});
geoapp.graphData.weatherboston = geoapp.graphDataClasses.weather({
    name: 'weatherboston',
    region: 'boston',
    region_name: 'Boston',
    region_shortname: 'Bos.'
});
geoapp.graphData.weatherdc = geoapp.graphDataClasses.weather({
    name: 'weatherdc',
    region: 'dc',
    region_name: 'D.C.',
    region_shortname: 'DC'
});

/* -------- taxi model graph data -------- */

geoapp.graphData.taximodel = function (arg) {
    'use strict';
    var m_datakey = 'taximodel';

    if (!(this instanceof geoapp.graphData[m_datakey])) {
        return new geoapp.graphData[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    var m_this = this;

    this.dataItems = {
        model: {
            name: 'NYC - Typical Trips',
            longname: 'Taxi - NYC - Typical Trips (statistical analysis)',
            description: 'Expected number of taxi trips under ordinary conditions (the seasonal and trend components of the modeled data)',
            units: 'trips/hour',
            format: m_this.unlog2
        },
        remainder: {
            name: 'NYC - Unusual Trips',
            longname: 'Taxi - NYC - Unusual Trips (total trips minus typical trips)',
            description: 'Taxi trips that aren\'t part of regular behavior (the remainder component of the modeled data)',
            units: '% diff',
            column: 'remainder',
            format: function (d) {
                /* convert to percent */
                return (Math.pow(2, d) * 100 - 100).toFixed(1);
            }
        },
        total: {
            name: 'NYC - Total Trips',
            longname: 'Taxi - NYC - Total Trips (for the entire data set)',
            description: 'All taxi trips for the entire city (the raw component of the model)',
            units: 'trips/hour',
            column: 'raw',
            format: m_this.unlog2
        }
    };

    geoapp.events.on('ga:staticDataLoaded.' + m_datakey, function () {
        this.dataTime(true);
        geoapp.graph.updateGraphDelayed();
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
                            Math.log(lastitem.tally / lastitem.count) /
                                Math.log(2)).toFixed(4);
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

    var m_this = this;

    this.dataItems = {
        pickups: {
            name: 'Trip Pickups',
            longname: 'Trip Pickups (based on current filters)',
            description: 'Filtered trip pickups',
            column: 'pickup_datetime',
            unit: 'trip',
            units: 'trips',
            axisunits: null
        },
        dropoffs: {
            name: 'Trip Dropoffs',
            longname: 'Trip Dropoffs (based on current filters)',
            description: 'Filtered trip dropoffs',
            column: 'dropoff_datetime',
            unit: 'trip',
            units: 'trips',
            axisunits: null
        },
        scaledpickups: {
            name: 'Trip Scaled Pickups',
            description: 'Filtered trip pickups scaled to full data range',
            column: 'pickup_datetime',
            scaled: true,
            units: 'trips/hour',
            format: m_this.unlog2
        },
        scaleddropoffs: {
            name: 'Trip Scaled Dropoffs',
            description: 'Filtered trip dropoffs scaled to full data range',
            column: 'dropoff_datetime',
            scaled: true,
            units: 'trips/hour',
            format: m_this.unlog2
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
            units: 'msgs',
            axisunits: null
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

/* -------- city graph data -------- */

geoapp.graphDataClasses.city = function (arg) {
    'use strict';
    var m_datakey = 'city';

    if (!(this instanceof geoapp.graphDataClasses[m_datakey])) {
        return new geoapp.graphDataClasses[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    if (arg.name) {
        m_datakey = arg.name;
    }
    var m_options = arg;

    this.dataItems = {
        crime_events: {
            name: 'Events',
            longname: 'Events',
            description: 'Frequency of all crime records',
            units: 'per hour'
        },
        transit_total: {
            name: 'Riders',
            longname: 'Weekend Late-Night Riders',
            description: 'Frequency of all riders entering the system on Friday and Saturday nights (10 p.m. to 3 a.m.)',
            units: 'per hour'
        },
        vendor_total: {
            name: 'Vendors',
            longname: 'Newly Licensed Food Vendors',
            description: 'Frequency of new food vendors being licensed',
            period: 'day',
            units: 'per day'
        }
    };

    _.each(this.dataItems, function (item) {
        if (m_options.region_name) {
            item.longname = (m_options.type_name + ' - ' +
                m_options.region_name + ' - ' + (item.longname || item.name));
        }
        if (m_options.region_shortname) {
            item.name = m_options.region_shortname + ' - ' + item.name;
        }
        if (item.regions && $.inArray(m_options.region, item.regions) < 0) {
            item.exclude = true;
        }
    });

    geoapp.events.on('ga:staticDataLoaded.' + m_datakey, function () {
        this.dataTime(true);
        geoapp.graph.updateGraphDelayed();
    }, this);

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey) {
        var data = geoapp.staticData ? geoapp.staticData[m_datakey] : null;
        if (data && !data.columns && data.fields) {
            data.columns = {};
            _.each(data.fields, function (key, idx) {
                if (key === 'start_date') {
                    key = 'date';
                } else if (key === 'date') {
                    key = 'datestr';
                } else {
                    key = m_options.type + '_' + key;
                }
                data.columns[key] = idx;
            });
        }
        if (!data || !data.columns || !data.data) {
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
        var binName = 'data-' + opts.bin,
            dataItem = this.dataItems[datakey];
        var binres = moment.duration(1, dataItem.period || 'hour');
        if (!dataItem[binName]) {
            var data = geoapp.staticData[m_datakey],
                xcol = data.columns.date,
                ycol = data.columns[dataItem.column || datakey],
                lastitem,
                periodsperbin = moment.duration(1, opts.bin) / binres,
                results = [];
            _.each(data.data, function (d) {
                var item = {
                        x: 0 + moment.utc(d[xcol]).startOf(opts.bin),
                        y: (parseFloat(d[ycol]) / periodsperbin).toFixed(3),
                        tally: d[ycol],
                        count: 1
                    };
                if (lastitem && item.x === lastitem.x) {
                    lastitem.count += 1;
                    lastitem.tally += item.tally;
                    if (lastitem.tally) {
                        lastitem.y = (lastitem.tally / periodsperbin).toFixed(
                                      3);
                    }
                } else {
                    results.push(item);
                    lastitem = item;
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
        var data = this.data(datakey, $.extend({}, opts, {bin: 'day'}));
        return {
            start: 0 + moment.utc(data[0].x).startOf('day'),
            end: 0 + moment.utc(data[data.length - 1].x).subtract(
                1, 'ms').endOf('day').add(1, 'ms')
        };
    };
};

inherit(geoapp.graphDataClasses.city, geoapp.GraphData);

geoapp.graphData.crimenyc = geoapp.graphDataClasses.city({
    type: 'crime',
    type_name: 'Crime',
    name: 'crimenyc',
    region: 'nyc',
    region_name: 'NYC',
    region_shortname: 'NYC'
});
geoapp.graphData.crimeboston = geoapp.graphDataClasses.city({
    type: 'crime',
    type_name: 'Crime',
    name: 'crimeboston',
    region: 'boston',
    region_name: 'Boston',
    region_shortname: 'Bos.'
});
geoapp.graphData.crimedc = geoapp.graphDataClasses.city({
    type: 'crime',
    type_name: 'Crime',
    name: 'crimedc',
    region: 'dc',
    region_name: 'D.C.',
    region_shortname: 'DC'
});
geoapp.graphData.transitboston = geoapp.graphDataClasses.city({
    type: 'transit',
    type_name: 'Mass Transit',
    name: 'transitboston',
    region: 'boston',
    region_name: 'Boston',
    region_shortname: 'Bos.'
});
geoapp.graphData.vendorboston = geoapp.graphDataClasses.city({
    type: 'vendor',
    type_name: 'Food Vendors',
    name: 'vendorboston',
    region: 'boston',
    region_name: 'Boston',
    region_shortname: 'Bos.'
});
