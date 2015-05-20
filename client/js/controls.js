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


/* Get a section from a settings dictionary, parsing it as a query string.  If
 * there are any default values for that section, and those defaults have not
 * been explicitly specified, use those defaults, too.
 *
 * @param settings: a settings dictionary.
 * @param section: the section within the dictionary to parse.
 * @return: results dictionary.
 */
geoapp.getQuerySection = function (settings, section) {
    if (geoapp.defaultControlsQuery === undefined) {
        geoapp.defaultControlsQuery = geoapp.parseJSON($('body').attr(
            'defaultControls'));
    }
    var results = geoapp.parseQueryString(settings[section] || '');
    if (geoapp.defaultControlsQuery[section]) {
        results = $.extend({}, geoapp.defaultControlsQuery[section], results);
    }
    return results;
};


geoapp.views.ControlsView = geoapp.View.extend({
    events: {
        'click #ga-taxi-filter': function () {
            $('#ga-taxi-filter').removeClass('btn-primary');
            this.updateView(true, 'taxi-filter');
        },
        'click #ga-instagram-filter': function () {
            $('#ga-instagram-filter').removeClass('btn-primary');
            this.updateView(true, 'instagram-filter');
        },
        'click #ga-anim-update': function () {
            $('#ga-anim-update').removeClass('btn-primary');
            if ($('#ga-play').val() === 'stop') {
                $('#ga-play').val('play');
            }
            this.updateView(true, 'anim');
        },
        'change #ga-display-settings select,#ga-display-settings input[type="text"],#ga-display-settings input[type="checkbox"]': function (evt) {
            $('#ga-display-update').removeClass('btn-primary');
            var combineNav = $(evt.target).is('.ga-slider-ctl');
            this.updateView(combineNav ? 'combine' : true, 'display');
        },
        'click #ga-display-update': function () {
            $('#ga-display-update').removeClass('btn-primary');
            geoapp.map.updateMapParams(
                'all', this.updateSection('display', false), 'always');
        },
        'click .ga-place': function (evt) {
            var place = $(evt.currentTarget).attr('data-place');
            if (geoapp.placeList[place]) {
                geoapp.map.fitBounds(geoapp.placeList[place], 1000, true);
            }
        },
        'click #ga-play': function () {
            this.animationAction('playpause');
        },
        'click #ga-anim-step-back': function () {
            this.animationAction('stepback');
        },
        'click #ga-anim-step': function () {
            this.animationAction('step');
        },
        'click #ga-anim-stop': function () {
            this.animationAction('stop');
        },
        'slide #ga-step-slider': function (evt) {
            this.animationAction('jump', evt.value);
        },
        'slideStart #ga-step-slider': function (evt) {
            this.animationAction('jump', evt.value);
        },
        'slideStop #ga-step-slider': function (evt) {
            this.animationAction('jump', evt.value);
        },
        'change #ga-taxi-filter-settings input[type="text"]:visible,#ga-taxi-filter-settings select:visible,#ga-data-trips': function () {
            $('#ga-taxi-filter').addClass('btn-primary');
        },
        'change #ga-instagram-filter-settings input[type="text"]:visible,#ga-instagram-filter-settings select:visible,#ga-inst-data-grams,#ga-instagram-filter-settings input[type="checkbox"]': function () {
            $('#ga-instagram-filter').addClass('btn-primary');
        },
        'change #ga-anim-settings input[type="text"]:visible,#ga-anim-settings select:visible': function () {
            $('#ga-anim-update').addClass('btn-primary');
        },
        'click #ga-instagram-results-sort': function () {
            geoapp.dataLoaders.instagram.sortOrder('toggle');
        },
        'keydown #ga-taxi-filter-settings input[type="text"]': function (evt) {
            if (evt.which === 13) {
                $('#ga-taxi-filter-settings .ga-date-range'
                    ).daterangepicker('hide');
                window.setTimeout(function () {
                    $('#ga-taxi-filter').click();
                }, 10);
            }
        },
        'keydown #ga-instagram-filter-settings input[type="text"]': function (evt) {
            if (evt.which === 13) {
                $('#ga-instagram-filter-settings .ga-date-range'
                    ).daterangepicker('hide');
                window.setTimeout(function () {
                    $('#ga-instagram-filter').click();
                }, 10);
            }
        },
        'keydown #ga-display-settings input[type="text"]': function (evt) {
            if (evt.which === 13) {
                window.setTimeout(function () {
                    $('#ga-display-update').click();
                }, 10);
            }
        },
        'keydown #ga-anim-settings input[type="text"]': function (evt) {
            if (evt.which === 13) {
                window.setTimeout(function () {
                    $('#ga-anim-update').click();
                }, 10);
            }
        },
        'click .panel-heading a': function (evt) {
            var elem = $('.panel-collapse', $(evt.currentTarget).closest(
                    '[id]')),
                id = elem.attr('id'),
                trigger = $('[data-toggle="collapse"][href="#' + id + '"],' +
                    '[data-toggle="collapse"][data-target="#' + id + '"]'),
                panel = {};

            panel[id] = trigger.hasClass('collapsed');
            geoapp.updateNavigation('mapview', 'panels', panel, true,
                                    true);
        },
        'apply.daterangepicker #ga-taxi-filter-settings .ga-date-range':  function () {
            $('#ga-taxi-filter').addClass('btn-needed');
        },
        'apply.daterangepicker #ga-instagram-filter-settings':  function () {
            $('#ga-instagram-filter').addClass('btn-needed');
        }
    },

    /* This is a dictionary of control sections used in routing. */
    controlSections: {
        'taxi-filter': '#ga-taxi-filter-settings #',
        'instagram-filter': '#ga-instagram-filter-settings #',
        display: '#ga-display-settings #',
        anim: '#ga-anim-settings #'
    },

    /* Initialize the view.
     *
     * @param settings: the initial settings.  This can include defaults for
     *                  the different control groups.
     */
    initialize: function (settings) {
        this.initialSettings = settings;
        girder.cancelRestRequests('fetch');
        this.firstRender = true;
        /* Load the list of place buttons */
        if (geoapp.defaultControlsQuery === undefined) {
            var places = geoapp.parseJSON($('body').attr('placeControls'));
            if (_.size(places) > 0) {
                geoapp.placeList = places;
                geoapp.placeOrder = [];
                _.each(places, function (place, key) {
                    geoapp.placeOrder.push(key);
                });
                geoapp.placeOrder.sort(function (a, b) {
                    if (places[b].order !== places[a].order) {
                        return (places[a].order || 0) - (places[b].order || 0);
                    }
                    return places[b].name < places[a].name ? 1 : -1;
                });
            }
        }
        this.render();
        geoapp.graph.initialize(this);
        this.finalizeInit(settings, 0);
    },

    /* Finish initializing or reinitializting the view.
     *
     * @param settings: the initial settings.  This can include defaults for
     *                  the different control groups.
     * @param speed: the number of milliseconds to take to pan the map.
     */
    finalizeInit: function (settings, speed) {
        geoapp.map.fitBounds(geoapp.getQuerySection(settings, 'map'), speed);
        geoapp.dataLoaders.instagram.routeSettings(
            geoapp.getQuerySection(settings, 'results'));
        geoapp.graph.graphsFromNavigation(
            geoapp.getQuerySection(settings, 'graph'));
        var panels = geoapp.getQuerySection(settings, 'panels');
        _.each(panels, function (show, id) {
            var trigger = $('[data-toggle="collapse"][href="#' + id + '"],' +
                '[data-toggle="collapse"][data-target="#' + id + '"]');
            show = (show && show !== 'false');
            var currentlyShown = !trigger.hasClass('collapsed');
            if (show !== currentlyShown) {
                var panel = $('.panel-collapse', trigger.attr('data-parent'));
                trigger.toggleClass('collapsed', !show);
                panel.collapse(show ? 'show' : 'hide');
            }
        });
    },

    /* Reinitialize the view.  This is called if we route to this view while
     * already showing it.  This ensures that the controls are appropriately
     * populated and only reloads things that have changed.
     *
     * @param settings: the initial settings.  This can include defaults for
     *                  the different control groups.
     */
    reinitialize: function (settings) {
        var view = this, update = {};
        _.each(view.controlSections, function (baseSelector, section) {
            var current = view.updateSection(section, false, true);
            var params = geoapp.getQuerySection(settings, section);
            _.each(current, function (value, id) {
                if (value !== (params[id] || '')) {
                    view.setControlValue(baseSelector + id, params[id] || '');
                    update[section] = true;
                }
            });
        });
        view.updateView(false, update);
        this.finalizeInit(settings, 1000);
    },

    /* Set the value of a control.  If this is a select control that doesn't
     * contain the specified value, add that value to the control.
     *
     * @param selector: the jquery selector for the control.
     * @param value: the value to set.
     */
    setControlValue: function (selector, value) {
        var elem = $(selector);
        value = '' + value;
        try {
            if (elem.is('[type=checkbox]')) {
                elem.prop('checked', value === 'true');
                return;
            }
            elem.val(value);
            if (elem.is('select') && elem.val() !== value &&
                    value !== '') {
                elem.append($('<option/>').attr({value: value})
                    .text(value));
                elem.val(value);
            }
        } catch (err) {
            console.log('Failed to set control value.  Caught a ' + err.name +
                        ' exception:', err.message, err.stack, err);
        }
    },

    /* Render the view.  This also prepares various controls if this is the
     * first load.
     */
    render: function () {
        var view = this;
        var ctls = this.$el.html(geoapp.templates.controls(
        )).on('ready.geoapp.view', function () {
            if (!$('#ga-source option').length) {
                $('#app-data taxidata option').each(function () {
                    var opt = $(this);
                    $('#ga-source').append(
                        $('<option>').attr('value', opt.attr('key'))
                        .text(opt.attr('name')));
                });
            }
            var update = false;
            if (view.initialSettings && !view.usedInitialSettings) {
                var settings = view.initialSettings;
                view.usedInitialSettings = true;
                _.each(view.controlSections, function (baseSelector, section) {
                    var params = geoapp.getQuerySection(settings, section);
                    _.each(params, function (value, id) {
                        if (value !== '' && value !== undefined) {
                            view.setControlValue(baseSelector + id, value);
                            update = true;
                        }
                    });
                });
            }
            $('#ga-main-page .ga-date-range').each(function () {
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
            $('[title]').tooltip({delay: {show: 500}});
            $('#ga-step-slider').slider({
                focus: true,
                formatter: geoapp.map.getStepDescription
            }).slider('disable');
            $('.ga-slider-ctl').each(function () {
                if ($(this).val().length) {
                    $(this).attr('data-slider-value', $(this).val());
                }
            });
            $('.ga-slider-ctl').slider({focus: true});
            if (view.firstRender) {
                view.firstRender = false;
                geoapp.map.showMap(
                    'all', [], view.updateSection('display', false));
                /* Make sure our layers are created in the desired order */
                geoapp.map.ensureLayer('taxi');
                geoapp.map.ensureLayer('instagram');
                _.each(geoapp.placeOrder, function (placeKey) {
                    var button = $('#ga-place-template').clone();
                    button.removeClass('hidden').attr({
                        'data-place': placeKey,
                        title: geoapp.placeList[placeKey].title
                    });
                    button.append(' ' + geoapp.placeList[placeKey].name);
                    $('#ga-place-group').append(button);
                });
            }
            if (update) {
                view.updateView(false);
            }
        });
        ctls.trigger($.Event('ready.geoapp.view', {relatedTarget: ctls}));
        $('#ga-main-map').off('ga.map.moved').on('ga.map.moved', function () {
            view.mapMoved();
        });
        geoapp.View.prototype.render.apply(this, arguments);
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
     * @param updateNav: true to update the navigation route.  'combine' to
     *                   combine updates to the navigation route if the section
     *                   is the same as the last changed.
     * @param updateSection: falsy to update all sections, a string to update
     *                       just one section, or an object with the keys which
     *                       have thuthy values are the sections to update.
     */
    updateView: function (updateNav, updateSection) {
        var results = {}, params;
        if (updateSection && $.type(updateSection) === 'string') {
            var sections = {};
            sections[updateSection] = true;
            updateSection = sections;
        }
        if (!updateSection || updateSection['taxi-filter']) {
            results['taxi-filter'] = this.updateSection(
                'taxi-filter', updateNav);
        }
        if (!updateSection || updateSection['instagram-filter']) {
            results['instagram-filter'] = this.updateSection(
                'instagram-filter', updateNav);
        }
        if (!updateSection || updateSection.display) {
            results.display = this.updateSection('display', updateNav);
            this.adjustControls(results);
        }
        if (!updateSection || updateSection.anim) {
            results.anim = this.updateAnimValues(updateNav);
        }
        if (!results.display && (results['taxi-filter'] ||
                results['instagram-filter'])) {
            results.display = this.updateSection('display', false);
        }
        if (results['taxi-filter']) {
            geoapp.dataLoaders.taxi.dataLoad({
                params: results['taxi-filter'],
                display: results.display
            });
        }
        if (results['instagram-filter']) {
            /* If 'use_taxi_dates' is checked, pull it from the taxi controls.
             */
            params = $.extend({}, results['instagram-filter']);
            if ('' + params.use_taxi_dates === 'true') {
                if (!results['taxi-filter']) {
                    results['taxi-filter'] = this.updateSection(
                        'taxi-filter', false);
                }
                _.each(['', '_min', '_max'], function (keySuffix) {
                    delete params['posted_date' + keySuffix];
                    if (results['taxi-filter'][
                            'pickup_datetime' + keySuffix]) {
                        params['posted_date' + keySuffix] = results[
                            'taxi-filter']['pickup_datetime' + keySuffix];
                    }
                });
            }
            delete params.use_taxi_dates;
            geoapp.dataLoaders.instagram.dataLoad({
                params: params,
                display: results.display
            });
        }
        if (results.display && !results['taxi-filter'] &&
                !results['instagram-filter']) {
            geoapp.map.updateMapParams('all', results.display);
        }
        if (results.anim) {
            geoapp.map.updateMapAnimation(results.anim);
        }
    },

    /* Update values associated with a section of the controls.
     *
     * @param section: the name of the section to update.  One of
     *                 'taxi-filter', 'instagram-filter', 'anim', or 'display'.
     * @param updateNav: true to update the navigation route.  'combine' to
     *                   combine updates to the navigation route if the section
     *                   is the same as the last changed.
     * @param returnVav: if true, return all of the navigation fields, even
     *                   blank ones.
     * @return: the new map filter parameters or the complete navigation
     *          fields.
     */
    updateSection: function (section, updateNav, returnNav) {
        var view = this;
        var selector = 'ga-' + section + '-settings';
        var params = {};
        var navFields = {};
        $('#' + selector + ' [taxifield]').each(function () {
            var elem = $(this);
            var value = view.getTaxiValue(elem, params);
            if (value !== '' || returnNav) {
                navFields[elem.attr('id')] = value;
            }
        });
        if (updateNav) {
            geoapp.updateNavigation('mapview', section, navFields, undefined,
                                    updateNav === 'combine');
        }
        if (returnNav) {
            return navFields;
        }
        return params;
    },

    /* Update values associated with the animation controls.
     *
     * @param updateNav: true to update the navigation route.  'combine' to
     *                   combine updates to the navigation route if the section
     *                   is the same as the last changed.
     * @return: the new animation parameters.
     */
    updateAnimValues: function (updateNav) {
        var params = this.updateSection('anim', updateNav);
        params.statusElem = '#ga-cycle-anim';
        params.sliderElem = '#ga-step-slider';
        return params;
    },

    /* Change which controls are visible based on other controls.
     *
     * @param values: current control values.  If not specified, this will be
     *                loaded as needed, in which case it may be modified.
     */
    adjustControls: function (values) {
        values = values || {};
        if (!values.display) {
            values.display = this.updateSection('display', false);
        }
        $('#ga-display-max-points-group').toggleClass('hidden', (
            values.display['display-process'] === 'binned' ||
            values.display['display-type'] === 'vector'));
        $('#ga-display-max-lines-group').toggleClass('hidden', (
            values.display['display-process'] === 'binned' ||
            values.display['display-type'] !== 'vector'));
        $('#ga-display-num-bins-group').toggleClass('hidden', (
            values.display['display-process'] !== 'binned'));
    },

    /* Get an value or range of values from a control.  The type is stored in
     * elem.attr('taxitype') and the key is stored in elem.attr('taxifield').
     *
     * @param selector: selector for input control.
     * @param params: dictionary in which to store result.
     * @returns: the unprocessed value of the element.
     */
    getTaxiValue: function (selector, params) {
        var elem = $(selector);
        var value = elem.val();
        if (elem.is('.ga-slider-ctl,.ga-slider-ctl-custom')) {
            value = '' + elem.slider('getValue');
        }

        var field = elem.attr('taxifield');
        if (!field) {
            return value;
        }
        var ttype = elem.attr('taxitype');
        switch (ttype) {
            case 'boolean':
                params[field] = elem.is(':checked') ? true : false;
                value = params[field];
                break;
            case 'dateRange':
                this.getDateRange(elem, params, field);
                break;
            case 'float':
                if (value !== null && value !== undefined &&
                        value.length > 0 && !isNaN(value)) {
                    params[field] = parseFloat(value);
                }
                break;
            case 'floatRange':
                this.getFloatRange(elem, params, field);
                break;
            case 'int':
                if (value !== null && value !== undefined &&
                        value.length > 0 && !isNaN(value)) {
                    params[field] = parseInt(value);
                }
                break;
            case 'intRange':
                this.getIntRange(elem, params, field);
                break;
            default:
                if (value !== null && value !== undefined && value.length > 0) {
                    params[field] = value;
                }
                break;
        }
        return value;
    },

    /* Perform an action on the animation.  Available actions are
     *  jump: go to the specified stepnum, maintaining the current play or
     *      paused state.
     *  playpause: toggles between playing and paused state.
     *  step: goes to the pause state.  If in the paused state, advance one
     *      frame.
     *  stepback: goes to the pause state.  If in the paused state, rewind one
     *      frame.
     *  stop: resets to no-animation state.
     *
     * @param action: one of the actions listed above.
     * @param stepnum: the explicit step to go to, if specified.
     */
    animationAction: function (action, stepnum) {
        var playState = action, step;

        if (stepnum !== undefined) {
            step = geoapp.map.animationAction('jump', stepnum);
            playState = $('#ga-play').val();
            if ($('#ga-play').val() !== 'play') {
                if (step !== undefined) {
                    playState = 'step' + step;
                }
            }
            action = 'none';
        }
        switch (action) {
            case 'playpause':
                if ($('#ga-play').val() !== 'play') {
                    playState = 'play';
                    geoapp.map.animationAction('play');
                    break;
                }
                /* intentionally fall through to 'step' */
                /* jshint -W086 */
            case 'step':
                step = geoapp.map.animationAction('step');
                if (step !== undefined) {
                    playState = 'step' + step;
                }
                break;
            case 'stepback':
                step = geoapp.map.animationAction('stepback');
                if (step !== undefined) {
                    playState = 'step' + step;
                }
                break;
            case 'stop':
                $('#ga-cycle-anim').text('Full Data');
                geoapp.map.animationAction('stop');
                break;
        }
        $('#ga-play').val(playState);
        geoapp.updateNavigation(
            'mapview', 'anim', {'ga-play': playState}, true);
    },

    /* When the map is moved, check if we need to mark that the display can be
     * updated. */
    mapMoved: function () {
        var display  = this.updateSection('display', false);
        if (display['display-process'] === 'binned') {
            $('#ga-display-update').addClass('btn-primary');
        }
    }
});

geoapp.placeOrder = [
    'manhattan', 'midtown', 'timessq'
];
geoapp.placeList = {
    manhattan: {
        name: 'Manhattan',
        title: 'Show all of Manhattan',
        x0: -74.0276489,
        y0:  40.8304859,
        x1: -73.9161453,
        y1:  40.6877773
    },
    midtown: {
        name: 'Midtown',
        title: 'Show Midtown',
        x0: -74.0140000,
        y0:  40.7730000,
        x1: -73.9588000,
        y1:  40.7320000
    },
    timessq: {
        name: 'Times Sq.',
        title: 'Show Times Square',
        x0: -74.0048904,
        y0:  40.7687378,
        x1: -73.9708862,
        y1:  40.7435085
    }
};

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
