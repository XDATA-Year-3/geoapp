
$(function () {
    var introHTML;

    /* Show the introduction dialog, if available.
     *
     * @param view: the parent view.
     * @param noShow: if true, prepare the intro, but don't show it.
     */
    geoapp.showIntroduction = function (view, noShow) {
        if (!introHTML) {
            introHTML = $('body').attr('introduction');
            $('body').attr('introduction', '');
            if (!introHTML) {
                return;
            }
            /* change the help button so that it will show the intro */
            $('#ga-help').attr({href: '', target: ''}).on(
                'click', function (evt) {
                    geoapp.showIntroduction(view);
                    evt.preventDefault();
                });
            var helptitle = $('.modal-body', geoapp.templates.introDialog(
                {title: ''})).attr('help-title');
            if (helptitle) {
                $('#ga-help').attr('data-original-title', helptitle).tooltip(
                    'fixTitle');
            }
        }
        if (noShow) {
            return;
        }
        var dialog = new geoapp.views.Introduction({
            el: $('#g-dialog-container'),
            intro: introHTML,
            parentView: view
        });
        dialog.render();
        return dialog;
    };

    geoapp.views.Introduction = geoapp.View.extend({
        initialize: function (settings) {
            this.settings = settings || {};
            this.viewName = 'Introduction';
        },

        render: function () {
            this.$el.html(geoapp.templates.introDialog({
                title: $('title').text()
            })).girderModal(this);
            geoapp.View.prototype.render.apply(this, arguments);
            $('.modal-body', this.$el).append(this.settings.intro);
            return this;
        }
    });
});
