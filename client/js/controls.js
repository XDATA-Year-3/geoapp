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

/* global geoapp, moment */

geoapp.defaults = geoapp.defaults || {};
geoapp.defaults.tooltip = {delay: {show: 500}};

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
        /* If this is the first time we see this, possible remove some controls
         * from the UI. */
        var removectls = geoapp.getQuerySection(settings, 'remove');
        _.each(removectls, function (remove, id) {
            remove = (remove && remove !== 'false');
            $('#' + id).remove();
        });
    }
    var results = geoapp.parseQueryString(settings[section] || '');
    if (geoapp.defaultControlsQuery[section]) {
        results = $.extend({}, geoapp.defaultControlsQuery[section], results);
    }
    return results;
};

geoapp.views.ControlsView = geoapp.View.extend({
    events: {
        'click [id^="ga-"][id$="-filter"]': function (evt) {
            var filter = $(evt.target).closest('[ga-section-name]').attr(
                'ga-section-name');
            $('#ga-' + filter + '-filter').removeClass('btn-primary');
            this.updateView(true, filter + '-filter');
        },
        'click #ga-anim-update': function () {
            $('#ga-anim-update').removeClass('btn-primary');
            if ($('#ga-play').val() === 'stop') {
                $('#ga-play').val('play');
            }
            this.updateView(true, 'anim');
        },
        'change .ga-display-controls select,.ga-display-controls input[type="text"],.ga-display-controls input[type="checkbox"]': function (evt) {
            var combineNav = $(evt.target).is('.ga-slider-ctl');
            this.updateView(combineNav ? 'combine' : true, 'display');
        },
        'click .ga-place': function (evt) {
            var place = $(evt.currentTarget).attr('data-place');
            if (geoapp.placeList[place]) {
                geoapp.map.fitBounds(geoapp.placeList[place], 1000, true);
            }
        },
        'click #ga-play': function () {
            if (_.isEqual(geoapp.map.getAnimationOptions(), {})) {
                $('#ga-anim-update').removeClass('btn-primary');
                if ($('#ga-play').val() === 'stop') {
                    $('#ga-play').val('play');
                }
                this.updateView(true, 'anim');
            } else {
                this.animationAction('playpause');
            }
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
        'change .ga-filter-controls input[type="text"]:visible,.ga-filter-controls select:visible,.ga-filter-controls input[type="checkbox"],.ga-filter-controls input[type="text"][data-slider-value],.ga-filter-controls .combobox': function (evt) {
            var sec = $(evt.target).closest('[ga-section-name]').attr('ga-section-name');
            $('#ga-' + sec + '-filter').addClass('btn-primary');
        },
        'change #ga-date-range,.ga-filter-controls[ga-section-name="general"] select:visible': function () {
            $('[id^="ga-"][id$="-filter"]').addClass('btn-primary');
        },
        'change .ga-anim-controls input[type="text"]:visible,.ga-anim-controls select:visible': function () {
            $('#ga-anim-update').addClass('btn-primary');
        },
        'click #ga-instagram-results-sort': function () {
            $.each(geoapp.dataLoaders, function (key) {
                if (geoapp.dataLoaders[key].sortOrder) {
                    geoapp.dataLoaders[key].sortOrder('toggle');
                }
            });
        },
        'keydown .ga-filter-controls input[type="text"]': function (evt) {
            if (evt.which === 13) {
                var filter = $(evt.target).closest('[ga-section-name]').attr(
                    'ga-section-name');
                $('.ga-filter-controls .ga-date-range').data(
                    'daterangepicker').hide();
                geoapp.waitForRepaint(function () {
                    if (filter !== 'general') {
                        $('#ga-' + filter + '-filter').click();
                    } else {
                        $('[id^="ga-"][id$="-filter"]').click();
                    }
                });
            }
        },
        'keydown .ga-display-controls input[type="text"]': function (evt) {
            if (evt.which === 13) {
                geoapp.waitForRepaint(this.displayUpdate);
            }
        },
        'keydown .ga-anim-controls input[type="text"]': function (evt) {
            if (evt.which === 13) {
                geoapp.waitForRepaint(function () {
                    $('#ga-anim-update').click();
                });
            }
        },
        'change #ga-cycle': function () {
            this.adjustControls();
        },
        'click .panel-heading a': function (evt) {
            if ($(evt.target).hasClass('notoggle')) {
                evt.preventDefault();
                evt.stopPropagation();
                return false;
            }
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
        'apply.daterangepicker .ga-filter-controls .ga-date-range': function (evt) {
            var val = this.getDateRange(evt.target, {}, 'date', true);
            $(evt.target).val(val);
            $('[id^="ga-"][id$="-filter"]').addClass('btn-primary');
            $('[id^="ga-"][id$="-filter"]').trigger('click');
        },
        'keydown input.ga-date-range': function (evt) {
            $(evt.target).data('daterangepicker').hide();
        },
        'show.daterangepicker': function (evt) {
            var val = this.getDateRange(evt.target, {}, 'date', true);
            if ($(evt.target).attr('has-relative-date') === 'true') {
                $(evt.target).data('daterangepicker').hide();
                return false;
            }
            $(evt.target).val(val);
        },
        'click #ga-general-settings-panel .ga-intents-button': function (evt) {
            this.showIntentsMenu(evt);
        }
    },

    /* This is a dictionary of control sections used in routing.  It is
     * adjusted in panelsFromConfig(). */
    controlSections: {
        anim: '.ga-anim-controls #'
    },

    /* Initialize the view.
     *
     * @param settings: the initial settings.  This can include defaults for
     *                  the different control groups.
     */
    initialize: function (settings) {
        var view = this;

        geoapp.map.parentView = this;
        this.initialSettings = settings;
        girder.cancelRestRequests('fetch');
        /* firstRender = true to not load data initially, 'update' to load
         * data. */
        this.firstRender = ($('body').attr('initialload') === 'true' ? 'update' : true);
        /* Load the list of place buttons. */
        if (geoapp.defaultControlsQuery === undefined) {
            var places = geoapp.parseJSON($('body').attr('placeControls'));
            if (_.size(places) > 0) {
                geoapp.placeList = places;
                geoapp.placeOrder = _.map(places, function (place, key) {
                    return key;
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
        $('[title]').tooltip(geoapp.defaults.tooltip);
        this.finalizeInit(settings, 0);
        $('.combobox').combobox();
        window.setTimeout(function () {
            geoapp.showIntroduction(view, view.renderNeededUpdate);
        }, 1);
    },

    /* Finish initializing or reinitializing the view.
     *
     * @param settings: the initial settings.  This can include defaults for
     *                  the different control groups.
     * @param speed: the number of milliseconds to take to pan the map.
     */
    finalizeInit: function (settings, speed) {
        $('#ga-general-settings-panel .ga-intents-button').toggleClass(
            'hidden', !$('body').attr('intentsserver'));
        var bounds = geoapp.getQuerySection(settings, 'map');
        if (!$.isEmptyObject(bounds)) {
            geoapp.map.fitBounds(bounds, speed);
        }
        if (geoapp.dataHandlers.instagram) {
            geoapp.dataLoaders.instagram.routeSettings(
                geoapp.getQuerySection(settings, 'results'));
        }
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
            var current = view.updateSection(section, false, true)[section];
            if (!current) {
                return;
            }
            var params = geoapp.getQuerySection(settings, section);
            if ($.isEmptyObject(params)) {
                return;
            }
            _.each(current, function (value, id) {
                if (value !== (params[id] || '')) {
                    view.setControlValue(baseSelector + id, params[id] || '');
                    update[section] = true;
                }
            });
        });
        view.updateView(false, update);
        view.updateView(false, 'display');
        view.finalizeInit(settings, 1000);
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
                if (value !== '') {
                    elem.prop('checked', value === 'true');
                }
                return;
            }
            if ($('input.combobox', elem.parent()).length > 0) {
                $('input.combobox', elem.parent()).val(value);
            }
            if (elem.hasClass('source-control') && elem.closest('.ga-filter-controls').find('.source-control-check').length > 0) {
                var values = value ? value.split(',') : [];
                $.each(elem.closest('.ga-filter-controls').find('.source-control-check input[type="checkbox"]'), function (idx, ctl) {
                    ctl = $(ctl);
                    ctl.prop('checked', $.inArray(ctl.attr('key'), values) >= 0);
                });
                value = values.length ? values[0] : '';
            }
            elem.val(value);
            if (elem.is('select') && elem.val() !== value &&
                    value !== '') {
                elem.append($('<option/>').attr({value: value})
                    .text(value));
                elem.val(value);
            } else if (elem.is('select') && value === '' &&
                    elem.val() === null) {
                elem.val($('option:first', elem).val());
            }
        } catch (err) {
            console.log('Failed to set control value.  Caught ' + err.name +
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
            var panels = view.panelsFromConfig();
            view.updateRegionControl();
            var optlist = {
                taxidata: 'source',
                instagramdata: 'msgsource'
            };
            $('[ga-section-name]').each(function () {
                var sec = $(this).attr('ga-section-name');
                if (!optlist[sec + 'data']) {
                    optlist[sec + 'data'] = sec + '-source';
                }
            });
            _.each(optlist, function (sourceelem, datakey) {
                if (!$('#ga-' + sourceelem + ' option').length) {
                    $('#app-data ' + datakey + ' option').each(function () {
                        var opt = $(this);
                        $('#ga-' + sourceelem).append(
                            $('<option>').attr('value', opt.attr('key'))
                            .text(opt.attr('name')));
                        var panelkey = $('#ga-' + sourceelem + '-check').attr('panelkey');
                        $('#ga-' + sourceelem + '-check').append(
                            $('<label>').append(
                                $('<input>').attr({type: 'checkbox', key: opt.attr('key')}).addClass('form-control input-sm').prop('checked', $.inArray(opt.attr('key'), (panels[panelkey] && panels[panelkey].checkSource) || []) >= 0)
                            ).append(
                                $('<span>').text(opt.attr('name')).html()
                            )
                        );
                    });
                }
            });
            var update = (view.firstRender === 'update');
            view.renderNeededUpdate = false;
            if (view.initialSettings && !view.usedInitialSettings) {
                var settings = view.initialSettings;
                view.usedInitialSettings = true;
                _.each(view.controlSections, function (baseSelector, section) {
                    var params = geoapp.getQuerySection(settings, section);
                    if ($.isEmptyObject(params)) {
                        return;
                    }
                    _.each(params, function (value, id) {
                        if (value !== '' && value !== undefined) {
                            view.setControlValue(baseSelector + id, value);
                            update = true;
                            view.renderNeededUpdate = true;
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
                                geoapp.defaults.startDate),
                    endDate: (params.date_max || params.date ||
                              geoapp.defaults.endDate),
                    format: 'YYYY-MM-DD HH:mm',
                    timePicker12Hour: false,
                    timePickerIncrement: 5
                });
                elem.data('daterangepicker').view = view;
                elem.data('daterangepicker').element
                .off('keyup.daterangepicker')
                .on({'keyup.daterangepicker': $.proxy(
                    view.DateRangePicker_updateFromControl,
                    elem.data('daterangepicker'))});
                var pick = elem.data('daterangepicker').container;
                pick.attr('loggroup', elem.attr('id') + '_calendar');
                $('.calendar.left', pick).attr(
                    'logid', 'calendar_start_panel');
                $('.calendar.right', pick).attr('logid', 'calendar_end_panel');
                $('.daterangepicker_start_input', pick).attr(
                    'logid', 'start_text');
                $('.daterangepicker_end_input', pick).attr(
                    'logid', 'end_text');
                $('.applyBtn', pick).attr('logid', 'apply');
                $('.cancelBtn', pick).attr('logid', 'cancel');
            });
            $('[title]').tooltip(geoapp.defaults.tooltip);
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
                    'all', view.updateSection('display', false));
                /* Make sure our layers are created in the desired order */
                geoapp.map.getLayer('taxi');
                if (geoapp.dataHandlers.instagram) {
                    geoapp.map.getLayer('instagram');
                }
                /* Add the place buttons */
                _.each(geoapp.placeOrder, function (placeKey) {
                    var button = $('#ga-place-template').clone();
                    button.removeClass('hidden').attr({
                        'data-place': placeKey,
                        title: geoapp.placeList[placeKey].title,
                        id: null,
                        logid: 'ga-place',
                        logsub: placeKey
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
        $('#ga-main-map').off('ga:map.moved.quick').on(
            'ga:map.moved.quick', function () {
                view.mapMoved();
            });
        geoapp.View.prototype.render.apply(this, arguments);
        return this;
    },

    /* Populate the region control */
    updateRegionControl: function () {
        if (!geoapp.regionOrder) {
            var regions = geoapp.parseJSON($('body').attr('regionControls'));
            for (var key in regions) {
                if (regions.hasOwnProperty(key) && !regions[key]) {
                    delete regions[key];
                }
            }
            if (_.size(regions) > 1) {
                geoapp.regionList = regions;
                geoapp.regionOrder = _.map(regions, function (region, key) {
                    return key;
                });
                geoapp.regionOrder.sort(function (a, b) {
                    if (regions[b].order !== regions[a].order) {
                        return (regions[a].order || 0) -
                               (regions[b].order || 0);
                    }
                    return regions[b].name < regions[a].name ? 1 : -1;
                });
            }
        }
        if ($('#ga-region option').length === 1) {
            _.each(geoapp.regionOrder, function (regionKey) {
                $('#ga-region').append($('<option>').attr(
                    'value', regionKey).text(
                    geoapp.regionList[regionKey].name));
            });
        }
        if ($('#ga-region option').length <= 1) {
            $('#ga-region').closest('.form-group').addClass('hidden');
        }
    },

    /* If any panels are specified in the config file, build them now. */
    panelsFromConfig: function () {
        var view = this;
        var panels = geoapp.parseJSON($('body').attr('panels'));
        var panelsByKey = {};
        $.each(panels, function (idx, panelSpec) {
            var key = panelSpec.key;
            if (!key) {
                console.log('Cannot create panel from config', panelSpec);
                return;
            }
            if ($('#ga-' + key + '-source').length > 0) {
                return;  /* already created */
            }
            panelSpec.name = panelSpec.name || key;
            panelSpec.names = panelSpec.names || panelSpec.name;
            panelSpec.capname = panelSpec.capname || panelSpec.name;
            panelSpec.capnames = panelSpec.capnames || panelSpec.capname;
            panelSpec.controls = panelSpec.controls || [];
            panelSpec.color = panelSpec.color || 'black';
            var html = geoapp.templates.controlsData(panelSpec);
            $('.insert-more-panels-here', $.el).before(html);
            /* Also create a datahandler and dataloader */
            geoapp.addDataHandler(panelSpec);
            geoapp.addMapLayer(panelSpec);
            geoapp.addGraphData(panelSpec);
            geoapp.dataLoaders[key] = geoapp.dataHandlers[key]();
            panelsByKey[key] = panelSpec;
        });
        $('[ga-section-name]').each(function () {
            var sec = $(this).attr('ga-section-name');
            if (sec === 'anim') {
                return;
            }
            view.controlSections[sec + '-filter'] = '.ga-filter-controls[ga-section-name="' + sec + '"] #';
            view.controlSections[sec + '-display'] = '.ga-display-controls[ga-section-name="' + sec + '"] #';
        });
        return panelsByKey;
    },

    /* Parse a string into a UTC moment.  The string can be:
     *   (a) any string momentjs can handle
     *   (b) (+|-)(float) - a number of seconds from now, where negative values
     * are in the past.
     *   (c) (float) (units) ('ago'|'from now') - an offset from now, where
     * 'ago' is in the past and 'from now' is in the future.
     *   (d) 'now' - the current time.
     *
     * @param val: the value to parse.
     * @param selector: a jquery selector to mark if the date is a relative
     *                  value.
     * @return: a parsed moment.
     */
    parseMomentUTC: function (val, selector) {
        val = val.trim();
        var parts;

        if (val === 'now') {
            val = undefined;
            $(selector).attr('has-relative-date', 'true');
        } else if (val.indexOf('ago') === val.length - 3 && val.length > 3) {
            parts = val.split(' ');
            val = moment.utc() - moment.duration(
                parseFloat(parts[0]), parts[1]);
            $(selector).attr('has-relative-date', 'true');
        } else if (val.indexOf('from now') === val.length - 8 &&
                val.length > 8) {
            parts = val.split(' ');
            val = moment.utc() + moment.duration(
                parseFloat(parts[0]), parts[1]);
            $(selector).attr('has-relative-date', 'true');
        } else if (val.indexOf('-') === 0 || val.indexOf('+') === 0) {
            val = moment.utc() + parseFloat(val) * 1000;
            $(selector).attr('has-relative-date', 'true');
        }
        return moment.utc(val);
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
     * @param formatForDisplay: if falsy, return the date formatted for
     *                          datebase queries.  If true, return the date
     *                          formatted for display.
     * @return: the cannonically formated date range, or null for no date
     *          range.
     */
    getDateRange: function (selector, params, baseKey, formatForDisplay) {
        var val = $(selector).val().trim(),
            minval, maxval, onlyval, form, result, parts,
            dbForm = 'YYYY-MM-DD HH:mm:ss',
            defaultYear = parseInt($('body').attr('defaultyear') || 2013);

        $(selector).attr('has-relative-date', 'false');
        if (val === '') {
            return null;
        }
        if ((val.match(/-/g) || []).length === 1) {
            parts = val.split('-');
        } else if ((val.match(/,/g) || []).length === 1) {
            parts = val.split(',');
        } else {
            parts = val.split('- ');
            if (parts.length === 1) {
                parts = val.split(' -');
            }
        }
        if (parts.length === 1) {
            onlyval = this.parseMomentUTC(val, selector);
            if (!onlyval.isValid()) {
                onlyval = null;
            } else {
                if (onlyval.year() < 1960) {
                    onlyval.year(defaultYear);
                }
                params[baseKey] = onlyval.format(dbForm);
            }
        } else {
            if (parts[0].trim() !== '') {
                minval = this.parseMomentUTC(parts[0], selector);
                if (!minval.isValid()) {
                    minval = null;
                } else {
                    if (minval.year() < 1960) {
                        minval.year(defaultYear);
                    }
                    params[baseKey + '_min'] = minval.format(dbForm);
                }
            }
            if (parts[1].trim() !== '') {
                maxval = this.parseMomentUTC(parts[1], selector);
                if (!maxval.isValid()) {
                    maxval = null;
                } else {
                    if (maxval.year() < 1960) {
                        maxval.year(defaultYear + (maxval.isSame(
                            moment(maxval).startOf('year')) ? 1 : 0));
                    }
                    params[baseKey + '_max'] = maxval.format(dbForm);
                }
            }
        }
        form = formatForDisplay ? 'MMM D HH:mm' : dbForm;
        if (formatForDisplay &&
                (!onlyval || onlyval.isSame(moment(onlyval).startOf('day'))) &&
                (!minval || minval.isSame(moment(minval).startOf('day'))) &&
                (!maxval || maxval.isSame(moment(maxval).startOf('day')))) {
            form = 'MMM D';
        }
        if (formatForDisplay) {
            form = 'YYYY ' + form;
        }
        if (onlyval) {
            result = onlyval.format(form);
        } else if (minval || maxval) {
            result = (minval ? minval.format(form) + ' ' : '') + '-' + (
                maxval ? ' ' + maxval.format(form) : '');
        } else {
            result = null;
        }
        return result;
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
     *                       have truthy values are the sections to update.
     */
    updateView: function (updateNav, updateSection) {
        var results = {}, params, view = this;
        if (updateSection && $.type(updateSection) === 'string') {
            var sections = {};
            sections[updateSection] = true;
            updateSection = sections;
        }
        var secs = {}, anysec;
        $('[ga-section-name]').each(function () {
            secs[$(this).attr('ga-section-name')] = true;
        });
        delete secs.general;
        delete secs.anim;

        results['general-filter'] = this.updateSection(
            'general-filter',
            updateNav || (!updateSection || updateSection['general-filter']));
        $.each(secs, function (sec) {
            if (!updateSection || updateSection[sec + '-filter'] ||
                    updateSection['general-filter']) {
                results[sec + '-filter'] = view.updateSection(
                    sec + '-filter', updateNav);
            }
        });
        if (!updateSection || updateSection.display) {
            results.display = this.updateSection('display', updateNav);
            this.adjustControls(results);
        }
        if (!updateSection || updateSection.anim) {
            results.anim = this.updateAnimValues(updateNav);
        }
        anysec = false;
        $.each(secs, function (sec) {
            anysec = anysec || results[sec + '-filter'];
        });
        if (!results.display && anysec) {
            results.display = this.updateSection('display', false);
        }
        if (results['taxi-filter'] && $('#ga-taxi-filter').length > 0) {
            params = $.extend({}, results['taxi-filter'],
                              results['general-filter']);
            _.each(['', '_min', '_max'], function (keySuffix) {
                delete params['pickup_datetime' + keySuffix];
                if (results['general-filter']['date' + keySuffix]) {
                    params['pickup_datetime' + keySuffix] = results['general-filter']['date' + keySuffix];
                }
            });
            geoapp.dataLoaders.taxi.dataLoad({
                params: params,
                display: results.display
            });
        }
        if (results['instagram-filter'] &&
                $('#ga-instagram-filter').length > 0) {
            params = $.extend({}, results['instagram-filter'],
                              results['general-filter']);
            _.each(['', '_min', '_max'], function (keySuffix) {
                delete params['posted_date' + keySuffix];
                if (results['general-filter']['date' + keySuffix]) {
                    params['posted_date' + keySuffix] = results['general-filter']['date' + keySuffix];
                }
            });
            params.source = params.msgsource;
            delete params.msgsource;
            geoapp.dataLoaders.instagram.dataLoad({
                params: params,
                display: results.display
            });
        }
        $.each(secs, function (sec) {
            if (sec === 'taxi' || sec === 'instagram') {
                return;
            }
            if (results[sec + '-filter'] && $('#ga-' + sec + '-filter').length > 0 && geoapp.dataLoaders[sec]) {
                params = $.extend({}, results[sec + '-filter'],
                                  results['general-filter']);
                params.source = params[sec + '_source'];
                geoapp.dataLoaders[sec].dataLoad({
                    params: params,
                    display: results.display
                });
            }
        });
        anysec = false;
        $.each(secs, function (sec) {
            anysec = anysec || results[sec + '-filter'];
        });
        if (results.display && !anysec) {
            geoapp.map.updateMapParams('all', results.display);
        }
        if (results.anim) {
            geoapp.map.updateMapAnimation(results.anim);
        }
    },

    /* Update values associated with a section of the controls.
     *
     * @param section: the name of the section to update.  This is of the
     *                 form [(dataset)-](section), where (dataset) is one of
     *                 the datasets ('taxi', 'instagram', 'general'), and
     *                 (section) is one of 'filter', 'display', 'anim'.
     * @param updateNav: true to update the navigation route.  'combine' to
     *                   combine updates to the navigation route if the section
     *                   is the same as the last changed.
     * @param returnVav: if true, return all of the navigation fields, even
     *                   blank ones.
     * @return: the new map filter parameters or the complete navigation
     *          fields.
     */
    updateSection: function (section, updateNav, returnNav) {
        var view = this, selector, navSection;
        if (section.indexOf('-') >= 0) {
            var parts = section.split('-');
            selector = '.ga-' + parts[1] + '-controls[ga-section-name="' +
                parts[0] + '"]';
            section = parts[1];
        } else {
            selector = '.ga-' + section + '-controls';
        }
        var params = {};
        var navFields = {};
        $(selector + ' [taxifield]').each(function () {
            var elem = $(this);
            var value = view.getTaxiValue(elem, params);
            if (value !== '' || returnNav || elem.is('select')) {
                navSection = $(elem).closest(
                    '.ga-' + section + '-controls').attr('ga-section-name');
                if (!navSection) {
                    navSection = section;
                }
                if (navSection !== section) {
                    navSection += '-' + section;
                }
                if (!navFields[navSection]) {
                    navFields[navSection] = {};
                }
                navFields[navSection][elem.attr('id')] = value;
            }
        });
        if (updateNav) {
            _.each(navFields, function (navSecFields, navSection) {
                geoapp.updateNavigation('mapview', navSection, navSecFields,
                                        undefined, updateNav === 'combine');
            });
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
        if (!values.anim) {
            values.anim = this.updateAnimValues(false);
        }
        $('#ga-display-max-points-group').toggleClass('hidden',
            values.display['display-process'] === 'binned' ||
            values.display['display-type'] === 'vector');
        $('#ga-display-max-lines-group').toggleClass('hidden',
            values.display['display-process'] === 'binned' ||
            values.display['display-type'] !== 'vector');
        $('#ga-data-opacity-group').toggleClass('hidden',
            values.display['display-process'] === 'binned');
        $('#ga-display-num-bins-group').toggleClass('hidden',
            values.display['display-process'] !== 'binned');
        $('#ga-cycle-group option[value="day"]').toggleClass('hidden',
            values.anim.cycle === 'day');
        $('#ga-cycle-group option[value="week"]').toggleClass('hidden',
            $.inArray(values.anim.cycle, ['day', 'week']) >= 0);
        $('#ga-cycle-group option[value="month"]').toggleClass('hidden',
            $.inArray(values.anim.cycle, ['day', 'week', 'month']) >= 0);
        $('#ga-cycle-group option[value="year"]').toggleClass('hidden',
            $.inArray(values.anim.cycle, ['day', 'week', 'month', 'year']) >= 0);
        if ($('#ga-cycle-group option[value="' + values.anim['cycle-group'] +
                '"]').hasClass('hidden')) {
            $('#ga-cycle-group').val(
                $('#ga-cycle-group option').not('.hidden').val());
        }
        var secs = {};
        $('[ga-section-name]').each(function () {
            secs[$(this).attr('ga-section-name')] = true;
        });
        $.each(secs, function (sec) {
            var mode = values.display['display-process-' + sec];
            if (mode === undefined) {
                return;
            }
            $('#ga-display-max-' + sec + '-points-group').toggleClass('hidden',
                mode === 'binned');
            $('#ga-' + sec + '-opacity-group').toggleClass('hidden',
                mode === 'binned');
            $('#ga-display-' + sec + '-num-bins-group').toggleClass('hidden',
                mode !== 'binned');
        });
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
        if (elem.hasClass('source-control') && elem.closest('.ga-filter-controls').find('.source-control-check').length > 0) {
            var values = _.chain(elem.closest('.ga-filter-controls').find('.source-control-check input[type="checkbox"]')).filter(function (ctl) {
                return $(ctl).prop('checked');
            }).map(function (ctl) {
                return $(ctl).attr('key');
            }).value();
            value = values.length ? values.join(',') : '';
        }

        var field = elem.attr('taxifield');
        if (!field) {
            return value;
        }
        var ttype = elem.attr('taxitype');
        switch (ttype) {
            case 'boolean':
                params[field] = !!elem.is(':checked');
                value = params[field];
                break;
            case 'combobox':
                if (value === '') {
                    value = $('input.combobox', elem.parent()).val();
                }
                if (value === '__blank__') {
                    value = '';
                }
                if (value !== null && value !== undefined && value.length > 0) {
                    params[field] = value;
                }
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

    /* Update the display based on all display settings. */
    displayUpdate: function () {
        geoapp.map.updateMapParams(
            'all', this.updateSection('display', false), 'always');
    },

    /* When the map is moved, check if we need to mark that the display can be
     * updated. */
    mapMoved: function () {
        var display = this.updateSection('display', false);
        var update = false;
        $.each(display, function (key, val) {
            update = update || (key.startsWith('display-process') &&
                                val === 'binned');
        });
        if (update) {
            geoapp.throttleCallback(
                'updatebin', _.bind(this.displayUpdate, this), 0, 300);
        }
    },

    /* Compose a list of information that might be usable by intents and ask
     * for a relevant intents menu.
     *
     * @param evt: the event that triggered this call.  Use to determine the
     *             position that the menu should be shown.
     */
    showIntentsMenu: function (evt) {
        var params = {},
            bounds = geoapp.map.getMap().bounds(),
            inst = this.updateSection('instagram-filter', false);
        var intentsData = {
            geobounds: JSON.stringify({
                long0: bounds.upperLeft.x.toFixed(7),
                lat1: bounds.upperLeft.y.toFixed(7),
                long1: bounds.lowerRight.x.toFixed(7),
                lat0: bounds.lowerRight.y.toFixed(7)
            })
        };
        this.getDateRange('#ga-main-page #ga-date-range', params, 'date',
                          true);
        if (params.date_min && params.date_max) {
            intentsData.daterange = JSON.stringify({
                start: moment.utc(params.date_min).format(
                    'YYYY-MM-DDTHH:mm:ss.SSS') + 'Z',
                end: moment.utc(params.date_max).format(
                    'YYYY-MM-DDTHH:mm:ss.SSS') + 'Z'
            });
        }
        if ((inst.caption_search || '').trim()) {
            intentsData.keyword = JSON.stringify(inst.caption_search.trim());
        }
        geoapp.intents.getIntents(intentsData, evt.target);
    },

    /* This is a copy of the original DateRangePicker updateFromControl that
     * doesn't require a fixed format date string */
    DateRangePicker_updateFromControl: function () {
        if (!this.element.is('input')) {
            return;
        }
        var val = this.view.getDateRange(this.element, {}, 'date');
        if (!val || !val.length) {
            return;
        }
        var dateString = val.split(' - '),
            start = null,
            end = null;
        if (dateString.length === 1) {
            dateString = val.split(' -');
        }
        if (dateString.length === 1) {
            dateString = val.split('- ');
        }
        if (dateString.length === 2) {
            start = moment(dateString[0].trim() ? dateString[0] : geoapp.defaults.startDate);
            end = moment(dateString[1].trim() ? dateString[1] : geoapp.defaults.endDate);
        }

        if (this.singleDatePicker || start === null || end === null) {
            start = moment(val);
            end = start;
        }
        if (end.isBefore(start)) {
            return;
        }
        this.oldStartDate = this.startDate.clone();
        this.oldEndDate = this.endDate.clone();

        this.startDate = start;
        this.endDate = end;

        if (!this.startDate.isSame(this.oldStartDate) || !this.endDate.isSame(this.oldEndDate)) {
            this.notify();
        }
        this.updateCalendars();
    }
});

geoapp.placeOrder = [
    'greater', 'manhattan', 'midtown'
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
    greater: {
        name: 'Greater NYC',
        title: 'Show NYC including surrounding airports',
        x0: -74.1670456,
        y0:  40.8645278,
        x1: -73.7660294,
        y1:  40.5900000
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
