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

geoapp.mapLayers = geoapp.mapLayers || {};

geoapp.MapLayer = function (map, datakey, arg) {
    'use strict';

    if (!(this instanceof geoapp.MapLayer)) {
        return new geoapp.MapLayer(map, datakey, arg);
    }
    arg = arg || {};

    var m_data,
        m_dataUpdated,
        m_dataVisibilityParams,
        m_dataVisible,
        m_dataVisibleUpdated,
        m_cycleDateRange;
    this.datakey = datakey;
    this.map = map;
    this.maximumMapPoints = 100000;
    this.maximumVectors = 50000;
    this.paramChangedKeys = [];

    /* Set or get the layer's data.   The data is an object that contains:
     *   columns: a dictionary which has keys that reference the columns in
     *      the data array.
     *   data: an array of arrays with the relevant data.
     *   x_column: if present, use the 0-based column for the x coordinate.
     *      Otherwise, use columns.pickup_longitude.
     *   y_column: if present, use the 0-based column for the y coordinate.
     *      Otherwise, use columns.pickup_latitude.
     * The visibility object can contain:
     *   dateColumn: the name of a column to use for date restrictions.  If not
     *      set or present, the date restriction is not used.
     *   dateMin: the minimum (inclusive) date for the data.
     *   dateMax: the maximum (exclusive) date for the data.
     *
     * @param data: if present, set the layer's data to this, otherwise return
     *              the current data.  If === true or === false, use this as
     *              the visibleData flag.
     * @param visibility: if present, retrict the visible data based on a set
     *                    of parameters (see above).
     * @param visibleData: if truthy, return the data with the visiblity
     *                     restrictions.
     * @return: return the current data or the currently visible data.
     */
    this.data = function (data, visibility, visibleData) {
        if (data === true || data === false) {
            visibleData = data;
            data = undefined;
        }
        if (data !== undefined) {
            m_data = data;
            m_dataUpdated = new Date().getTime();
            m_dataVisible = null;
        }
        if (visibility !== undefined &&
                !_.isEqual(visibility, m_dataVisibilityParams)) {
            m_dataVisibilityParams = visibility;
            m_dataVisible = null;
        }
        if (!m_dataVisible && visibleData) {
            var vis = m_dataVisibilityParams, col;
            data = m_data;
            if (vis && vis.dateColumn && data.data && data.columns &&
                    data.columns[vis.dateColumn] !== undefined && (
                    vis.dateMin || vis.dateMax)) {
                data = _.clone(data);
                col = data.columns[vis.dateColumn];
                data.data = _.filter(data.data, function (d) {
                    return ((!vis.dateMin || d[col] >= vis.dateMin) &&
                        (!vis.dateMax || d[col] < vis.dateMax));
                });
            }
            m_dataVisible = data;
            m_dataVisibleUpdated = new Date().getTime();
            geoapp.events.trigger('ga:dataVisibility.' + this.datakey, {
                visibility: vis,
                dataDate: m_dataUpdated,
                visDate: m_dataVisibleUpdated,
                length: (data && data.data) ? data.data.length : 0
            });
        }
        return visibleData ? m_dataVisible : m_data;
    };

    /* Check if a changing parameter means that this map layer needs to be
     * updated.
     *
     * @param params: the new parameters.
     * @param origParams: the parameters before the changes.
     * @param update: 'always' if this should always update if there is data
     *                present.
     * @return: true if the layer needs updating.
     */
    this.paramsChanged = function (params, origParams, update) {
        var changed = false;
        if (m_data && m_data.data && update === 'always') {
            return true;
        }
        this.paramChangedKeys.forEach(function (key) {
            changed = changed || (params[key] !== origParams[key]);
        });
        return changed;
    };

    /* Get the first and last dates of the data.
     *
     * @return: an object with start and end in epoch milliseconds, or null if
     *          we don't know how to compute the date range.
     */
    this.getDateRange = function () {
        if (!this.getDateColumn || !m_data || !m_data.data ||
                !m_data.data.length) {
            return null;
        }
        var col = this.getDateColumn(), data = m_data.data;
        var start = data[0][col], end = data[0][col];
        var i;
        for (i = 1; i < data.length; i += 1) {
            if (data[i][col] < start) {
                start = data[i][col];
            }
            if (data[i][col] > end) {
                end = data[i][col];
            }
        }
        return {start: start, end: end};
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

    /* Set the date range to use for the data cycle.
     *
     * @param params: an object to extract the dates from.
     * @param minkey: the key to use within the object to get the minimum date
     *                in epoch milliseconds.  The key doesn't have to exist.
     * @param maxkey: the key to use within the object to get the maximum date
     *                in epoch milliseconds.  The key doesn't have to exist.
     * @param datakey: the datakey of item that is setting the date range.
     */
    this.setCycleDateRange = function (params, minkey, maxkey, datakey) {
        if (params && params[minkey] !== params[maxkey]) {
            m_cycleDateRange = {
                date_min: params[minkey],
                date_max: params[maxkey]
            };
        } else {
            m_cycleDateRange = null;
        }
        geoapp.map.setCycleDateRange(params, minkey, maxkey, datakey);
    };

    /* Get the cycle date range for this data layer.
     *
     * @returns: the start and end of the cycle range as either defined by the
     *           original request or by the data itself.  The results are in
     *           epoch milliseconds.
     */
    this.cycleDateRange = function () {
        var end = null, start;
        if (m_cycleDateRange) {
            start = moment.utc(geoapp.defaults.startDate);
            end = moment.utc(geoapp.defaults.endDate);
            if (m_cycleDateRange.date_min) {
                start = moment.utc(m_cycleDateRange.date_min);
            }
            if (m_cycleDateRange.date_max) {
                end = moment.utc(m_cycleDateRange.date_max);
            }
        }
        if (!end) {
            var dateRange = this.getDateRange();
            if (dateRange && dateRange.start && dateRange.end) {
                start = dateRange.start;
                end = dateRange.end;
                if (moment(end) - moment(start) >
                        moment.duration(2, moment.normalizeUnits('months'))) {
                    start = moment.utc(start).startOf('month');
                    end = moment.utc(end - 1).startOf('month').add(1, 'month');
                }
            }
        }
        return {start: 0 + start, end: 0 + end};
    };
};
