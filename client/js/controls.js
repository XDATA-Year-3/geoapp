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

geoapp.views.ControlsView = geoapp.View.extend({
    events: {
        'click #ga-controls-filter': function () {
            this.updateView(true, 'filter');
        }
    },

    initialize: function (settings) {
        this.initialSettings = settings;
        girder.cancelRestRequests('fetch');
        this.render();
    },
    
    render: function () {
        var view = this;
        var ctls = this.$el.html(geoapp.templates.controls(
        )).on('ready.geoapp.view', function () {
            update = false;
            if (view.initialSettings && !view.usedInitialSettings) {
                settings = view.initialSettings;
                view.usedInitialSettings = true;
                if (settings.filter) {
                    params = geoapp.parseQueryString(settings.filter);
                    _.each(params, function (value, id) {
                        try {
                            if (value !== '' && value !== undefined) {
                                $('#ga-settings #'+id).val(value);
                                update = true;
                            }
                        } catch (err) { ; }
                    });
                }
            }
            $('#ga-settings .ga-date-range').each(function () {
                var elem = $(this);
                var params = {};
                view.getDateRange(elem, params, 'date');
                elem.daterangepicker({
                    timePicker: true,
                    startDate: (params.date_min || params.date ||
                                '2013-01-01 00:00'),
                    endDate: (params.date_max || params.date ||
                              '2014-01-01 00:00'),
                    format: 'YYYY-MM-DD HH:mm',
                    timePicker12Hour: false,
                    timePickerIncrement: 5
                });
            });
            if (update) {
                view.updateView(false);
            }
        });
        showMap([]);
        ctls.trigger($.Event('ready.geoapp.view', {relatedTarget: ctls}));
        return this;
    },

    /* Get a range from a date range control.  The ranges are of the form
     * YYYY-MM-DD hh:mm:ss - YYYY-MM-DD hh:mm:ss .  Everything is optional.
     * The ranges must be separated by the string ' - '.
     * @param selector: selector for input control.
     * @param params: dictionary in which to store result.
     * @param baseKey: baseKey for which to store the value.  If there is no
     *                 range separator, this is assumed to be a singular
     *                 entry.
     */
    getDateRange: function (selector, params, baseKey) {
        var val = $(selector).val().trim();
        if (val === '') {
            return;
        }
        var parts = val.split(' - ');
        if (parts.length === 1) {
            params[baseKey] = val;
            return;
        }
        if (parts[0].trim() !== '') {
            params[baseKey+'_min'] = parts[0].trim();
        }
        if (parts[1].trim() !== '') {
            params[baseKey+'_max'] = parts[1].trim();
        }
    },

    /* Get a floating-point range from a control.  The ranges are of the form
     * (min value) - (max value).  Everything is optional.  The ranges must be
     * separated by the string '-'.
     * @param selector: selector for input control.
     * @param params: dictionary in which to store result.
     * @param baseKey: baseKey for which to store the value.  If there is no
     *                 range separator, this is assumed to be a singular
     *                 entry.
     */
    getFloatRange: function (selector, params, baseKey) {
        var val = $(selector).val().trim();
        if (val === '') {
            return;
        }
        var parts = val.split('-');
        if (parts.length === 1) {
            if (!isNaN(parseFloat(val))) {
                params[baseKey] = parseFloat(val);
            }
            return;
        }
        if (parts[0].trim() !== '') {
            val = parseFloat(parts[0].trim());
            if (!isNaN(val)) {
                params[baseKey+'_min'] = val;
            }
        }
        if (parts[1].trim() !== '') {
            val = parseFloat(parts[1].trim());
            if (!isNaN(val)) {
                params[baseKey+'_max'] = val;
            }
        }
    },

    /* Get an integer range from a control.  The ranges are of the form
     * (min value) - (max value).  Everything is optional.  The ranges must be
     * separated by the string '-'.
     * @param selector: selector for input control.
     * @param params: dictionary in which to store result.
     * @param baseKey: baseKey for which to store the value.  If there is no
     *                 range separator, this is assumed to be a singular
     *                 entry.
     */
    getIntRange: function (selector, params, baseKey) {
        var val = $(selector).val().trim();
        if (val === '') {
            return;
        }
        var parts = val.split('-');
        if (parts.length === 1) {
            if (!isNaN(parseInt(val))) {
                params[baseKey] = parseInt(val);
            }
            return;
        }
        if (parts[0].trim() !== '') {
            val = parseInt(parts[0].trim());
            if (!isNaN(val)) {
                params[baseKey+'_min'] = val;
            }
        }
        if (parts[1].trim() !== '') {
            val = parseInt(parts[1].trim());
            if (!isNaN(val)) {
                params[baseKey+'_max'] = val;
            }
        }
    },

    updateView: function (updateNav, updateSection) {
        var view = this;
        var newMapData = false;
        if (!updateSection || updateSection === 'filter') {
            var params = {}
            var navFields = {}
            $('#ga-settings [taxifield]').each(function () {
                var elem = $(this);
                var value = elem.val();
                if (value !== '') {
                    navFields[elem.attr('id')] = value;
                }
                var ttype = elem.attr('taxitype');
                switch (ttype) {
                    case 'dateRange':
                        view.getDateRange(elem, params,
                                          elem.attr('taxifield'));
                        break;
                    case 'floatRange':
                        view.getFloatRange(elem, params,
                                           elem.attr('taxifield'));
                        break;
                    case 'intRange':
                        view.getIntRange(elem, params, elem.attr('taxifield'));
                        break;
                    default:
                        if (value.length > 0) {
                            params[elem.attr('taxifield')] = elem.val();
                        }
                        break;
                }
            });
            if (updateNav) {
                geoapp.updateNavigation('mapview', 'filter', navFields);
            }
            newMapData = params;
        }
        if (newMapData !== false) {
            replaceMapData({params: newMapData});
        }
    }
});

function routeToControls(params) {
    geoapp.events.trigger(
        'ga:navigateTo', geoapp.views.ControlsView, _.extend({
        }, params || {}));
}

geoapp.router.route('', 'mapview', routeToControls);
geoapp.router.route('mapview', 'mapview', routeToControls);
