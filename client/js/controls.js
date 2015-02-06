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
        },
        'click #ga-display-update': function () {
            this.updateView(true, 'display');
        },
        'click #ga-display-play': function () {
            this.animationAction('playpause');
        },
        'click #ga-display-step': function () {
            this.animationAction('step');
        },
        'click #ga-display-stop': function () {
            this.animationAction('stop');
        }
    },

    /* Initialize the view.
     *
     * @params settings: the initial settings.  This can include defaults for
     *                   the different control groups.
     */
    initialize: function (settings) {
        this.initialSettings = settings;
        girder.cancelRestRequests('fetch');
        this.render();
    },

    /* Render the view.  This also prepares various controls if this is the
     * first load.
     */
    render: function () {
        var view = this;
        var ctls = this.$el.html(geoapp.templates.controls(
        )).on('ready.geoapp.view', function () {
            update = false;
            if (view.initialSettings && !view.usedInitialSettings) {
                settings = view.initialSettings;
                view.usedInitialSettings = true;
                var sections = {
                    filter: '#ga-filter-settings #',
                    display: '#ga-display-settings #'
                };
                _.each(sections, function (baseSelector, section) {
                    if (settings[section]) {
                        params = geoapp.parseQueryString(settings[section]);
                        _.each(params, function (value, id) {
                            try {
                                if (value !== '' && value !== undefined) {
                                    $(baseSelector + id).val(value);
                                    update = true;
                                }
                            } catch (err) { }
                        });
                    }
                });
            }
            $('#ga-filter-settings .ga-date-range').each(function () {
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
        geoapp.map.showMap([]);
        ctls.trigger($.Event('ready.geoapp.view', {relatedTarget: ctls}));
        return this;
    },

    /* Get a range from a date range control.  The ranges are of the form
     * YYYY-MM-DD hh:mm:ss - YYYY-MM-DD hh:mm:ss .  Everything is optional.
     * The ranges must be separated by the string ' - '.
     *
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
            params[baseKey + '_min'] = parts[0].trim();
        }
        if (parts[1].trim() !== '') {
            params[baseKey + '_max'] = parts[1].trim();
        }
    },

    /* Get a floating-point range from a control.  The ranges are of the form
     * (min value) - (max value).  Everything is optional.  The ranges must be
     * separated by the string '-'.
     *
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
                params[baseKey + '_min'] = val;
            }
        }
        if (parts[1].trim() !== '') {
            val = parseFloat(parts[1].trim());
            if (!isNaN(val)) {
                params[baseKey + '_max'] = val;
            }
        }
    },

    /* Get an integer range from a control.  The ranges are of the form
     * (min value) - (max value).  Everything is optional.  The ranges must be
     * separated by the string '-'.
     *
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
                params[baseKey + '_min'] = val;
            }
        }
        if (parts[1].trim() !== '') {
            val = parseInt(parts[1].trim());
            if (!isNaN(val)) {
                params[baseKey + '_max'] = val;
            }
        }
    },

    /* Update some portion of the view.  This parses the specified section,
     * and, if appropriate, updates the map or other details.
     *
     * @param updateNav: true to update the navigation route.
     * @param updateSection: the section to update.  If not specified, update
     *                       all sections.
     */
    updateView: function (updateNav, updateSection) {
        var results = {};
        if (!updateSection || updateSection === 'filter') {
            results.newMapData = this.updateFilter(updateNav);
        }
        if (!updateSection || updateSection === 'display') {
            results.newDisplayValues = this.updateDisplayValues(updateNav);
        }
        if (results.newMapData) {
            geoapp.map.replaceMapData({params: results.newMapData});
        }
        if (results.newDisplayValues) {
            geoapp.map.updateMapAnimation(results.newDisplayValues);
        }
    },

    /* Update values associated with the filter controls.
     *
     * @param updateNav: true to update the navigation route.
     * @return: the new map filter parameters.
     */
    updateFilter: function (updateNav) {
        var view = this;
        var params = {};
        var navFields = {};
        $('#ga-filter-settings [taxifield]').each(function () {
            var elem = $(this);
            var value = elem.val();
            if (value !== '') {
                navFields[elem.attr('id')] = value;
            }
            view.getTaxiValue(elem, params);
        });
        if (updateNav) {
            geoapp.updateNavigation('mapview', 'filter', navFields);
        }
        return params;
    },

    /* Update values associated with the display controls.
     *
     * @param updateNav: true to update the navigation route.
     * @return: the new display parameters.
     */
    updateDisplayValues: function (updateNav, results) {
        var view = this;
        var params = {};
        var navFields = {};
        $('#ga-display-settings [taxifield]').each(function () {
            var elem = $(this);
            var value = elem.val();
            if (value !== '') {
                navFields[elem.attr('id')] = value;
            }
            view.getTaxiValue(elem, params);
        });
        if (updateNav) {
            geoapp.updateNavigation('mapview', 'display', navFields);
        }
        params.statusElem = '#ga-cycle-display';
        return params;
    },

    /* Get an value or range of values from a control.  The type is stored in
     * elem.attr('taxitype') and the key is stored in elem.attr('taxifield').
     *
     * @param selector: selector for input control.
     * @param params: dictionary in which to store result.
     */
    getTaxiValue: function (selector, params) {
        var elem = $(selector);
        var value = elem.val();
        var field = elem.attr('taxifield');
        if (!field) {
            return;
        }
        var ttype = elem.attr('taxitype');
        switch (ttype) {
            case 'dateRange':
                this.getDateRange(elem, params, field);
                break;
            case 'floatRange':
                this.getFloatRange(elem, params, field);
                break;
            case 'intRange':
                this.getIntRange(elem, params, field);
                break;
            default:
                if (value.length > 0) {
                    params[field] = elem.val();
                }
                break;
        }
    }
});

/* Given an appropriate route, redirect to the ControlsView.
 *
 * @params params: query parameters specified as part of the route.
 */
function routeToControls(params) {
    geoapp.events.trigger(
        'ga:navigateTo', geoapp.views.ControlsView, _.extend({
        }, params || {}));
}

geoapp.router.route('', 'mapview', routeToControls);
geoapp.router.route('mapview', 'mapview', routeToControls);
