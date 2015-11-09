geoapp.intents = {
    getIntents: function (intentsData, target) {
        geoapp.cancelRestRequests('intents');
        var xhr = Backbone.ajax({
            url: $('body').attr('intentsserver'),
            dataType: 'json',
            type: 'GET',
            data: intentsData
        }).done(_.bind(function (resp) {
            geoapp.intents.showMenu(intentsData, target, resp);
        }, this));
        xhr.girder = {intents: true};
    },

    showMenu: function (intentsData, target, intents) {
        var widget = new geoapp.views.IntentsMenu({
            el: $('#g-dialog-container'),
            intentsData: intentsData,
            target: target,
            intents: intents,
            parentView: geoapp.map.parentView
        });
        widget.render();
    }
};

geoapp.views.IntentsMenu = geoapp.View.extend({
    events: {
    },

    /* Initialize the widget.  The settings include:
     *  el: the container element for the widget.  Typically
     *      $('#g-dialog-container').
     *  intents: the known intents.
     *  target: the control that was selected.
     *  intentsData: the original data used to get intents.
     *
     * @param settings: settings dictionary, as above.
     */
    initialize: function (settings) {
        geoapp.View.prototype.initialize.apply(this, arguments);
        this.settings = settings || {};
        this.viewName = 'IntentsMenu';
    },

    /* Draw the menu.
     */
    render: function () {
        var target = this.settings.target,
            intents = this.settings.intents;
        this.$el.html(geoapp.templates.intentsMenu({
            intents: intents
        })).girderModal(this).on('shown.bs.modal', function () {
            var w = $('.ga-intents-dialog').outerWidth(true),
                h = $('.ga-intents-dialog').outerHeight(true),
                mapW = $('#ga-main-map').width(),
                mapH = $('#ga-main-map').height(),
                tx = $(target).offset().left,
                ty = $(target).offset().top,
                tw = $(target).outerWidth(false),
                th = $(target).outerHeight(false),
                x = tx + tw + 5,
                y = Math.max(0, Math.min(ty + th / 2 - h / 2, mapH - h));
            if (x + w > mapW) {
                x = tx - 5 - w;
            }
            $('.ga-intents-dialog').css({
                left: x + 'px', top: y + 'px', visibility: 'visible'});
            console.log(w, h, mapW, mapH, tx, ty, tw, th, x, y);
        });
        geoapp.View.prototype.render.apply(this, arguments);
        return this;
    }
});
