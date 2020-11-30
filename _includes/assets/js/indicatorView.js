var indicatorView = function (model, options) {

  "use strict";

  var view_obj = this;
  this._model = model;

  this._chartInstance = undefined;
  this._rootElement = options.rootElement;
  this._tableColumnDefs = options.tableColumnDefs;
  this._mapView = undefined;
  this._legendElement = options.legendElement;

  var chartHeight = screen.height < options.maxChartHeight ? screen.height : options.maxChartHeight;

  $('.plot-container', this._rootElement).css('height', chartHeight + 'px');

  $(document).ready(function() {
    $(view_obj._rootElement).find('a[data-toggle="tab"]').on('shown.bs.tab', function (e) {
      if($(e.target).attr('href') == '#tableview') {
        setDataTableWidth($(view_obj._rootElement).find('#selectionsTable table'));
      } else {
        $($.fn.dataTable.tables(true)).css('width', '100%');
        $($.fn.dataTable.tables(true)).DataTable().columns.adjust().draw();
      }
    });

    $(view_obj._legendElement).on('click', 'li', function(e) {
      $(this).toggleClass('notshown');

      var ci = view_obj._chartInstance,
          index = $(this).data('datasetindex'),
          meta = ci.getDatasetMeta(index);

      meta.hidden = meta.hidden === null? !ci.data.datasets[index].hidden : null;
      ci.update();
    });

    // Provide the hide/show functionality for the sidebar.
    $('.data-view .nav-link').on('click', function(e) {
      var $sidebar = $('.indicator-sidebar'),
          $main = $('.indicator-main'),
          hideSidebar = $(this).data('no-disagg'),
          mobile = window.matchMedia("screen and (max-width: 990px)");
      if (hideSidebar) {
        $sidebar.addClass('indicator-sidebar-hidden');
        $main.addClass('indicator-main-full');
        // On mobile, this can be confusing, so we need to scroll to the tabs.
        if (mobile.matches) {
          $([document.documentElement, document.body]).animate({
            scrollTop: $("#indicator-main").offset().top - 40
          }, 400);
        }
      }
      else {
        $sidebar.removeClass('indicator-sidebar-hidden');
        $main.removeClass('indicator-main-full');
      }
    });
  });

  this._model.onDataComplete.attach(function (sender, args) {

    if(view_obj._model.showData) {

      $('#dataset-size-warning')[args.datasetCountExceedsMax ? 'show' : 'hide']();

      if(!view_obj._chartInstance) {
        view_obj.createPlot(args);
      } else {
        view_obj.updatePlot(args);
      }
    }

    view_obj.createSelectionsTable(args);

    view_obj.updateChartTitle(args.chartTitle);
  });

  this._model.onFieldsComplete.attach(function(sender, args) {
    view_obj.initialiseFields(args);

    if(args.hasGeoData && args.showMap) {
      view_obj._mapView = new mapView();
      view_obj._mapView.initialise(args.indicatorId);
    }
  });

  this._model.onUnitsComplete.attach(function(sender, args) {
    view_obj.initialiseUnits(args);
  });

  this._model.onFieldsCleared.attach(function(sender, args) {
    $(view_obj._rootElement).find(':checkbox').prop('checked', false);
    $(view_obj._rootElement).find('#clear').addClass('disabled').attr('aria-disabled', 'true');

    // reset available/unavailable fields
    updateWithSelectedFields();

    $(view_obj._rootElement).find('.selected').css('width', '0');
  });

  this._model.onSelectionUpdate.attach(function(sender, args) {
    if (args.selectedFields.length) {
      $(view_obj._rootElement).find('#clear').removeClass('disabled').attr('aria-disabled', 'false');
    }
    else {
      $(view_obj._rootElement).find('#clear').addClass('disabled').attr('aria-disabled', 'true');
    }

    // loop through the available fields:
    $('.variable-selector').each(function(index, element) {
      var currentField = $(element).data('field');

      // any info?
      var match = _.findWhere(args.selectedFields, { field : currentField });
      var element = $(view_obj._rootElement).find('.variable-selector[data-field="' + currentField + '"]');
      var width = match ? (Number(match.values.length / element.find('.variable-options label').length) * 100) + '%' : '0';

      $(element).find('.bar .selected').css('width', width);

      // is this an allowed field:
      $(element)[_.contains(args.allowedFields, currentField) ? 'removeClass' : 'addClass']('disallowed');
    });
  });

  this._model.onFieldsStatusUpdated.attach(function (sender, args) {

    // reset:
    $(view_obj._rootElement).find('label').removeClass('selected possible excluded');

    _.each(args.data, function(fieldGroup) {
      _.each(fieldGroup.values, function(fieldItem) {
        var element = $(view_obj._rootElement).find(':checkbox[value="' + fieldItem.value + '"][data-field="' + fieldGroup.field + '"]');
        element.parent().addClass(fieldItem.state).attr('data-has-data', fieldItem.hasData);
      });
      // Indicate whether the fieldGroup had any data.
      var fieldGroupElement = $(view_obj._rootElement).find('.variable-selector[data-field="' + fieldGroup.field + '"]');
      fieldGroupElement.attr('data-has-data', fieldGroup.hasData);

      // Re-sort the items.
      view_obj.sortFieldGroup(fieldGroupElement);
    });

    _.each(args.selectionStates, function(ss) {
      // find the appropriate 'bar'
      var element = $(view_obj._rootElement).find('.variable-selector[data-field="' + ss.field + '"]');
      element.find('.bar .default').css('width', ss.fieldSelection.defaultState + '%');
      element.find('.bar .possible').css('width', ss.fieldSelection.possibleState + '%');
      element.find('.bar .excluded').css('width', ss.fieldSelection.excludedState + '%');
    });
  });

  $(this._rootElement).on('click', '#clear', function() {
    view_obj._model.clearSelectedFields();
  });

  $(this._rootElement).on('click', '#fields label', function (e) {

    if(!$(this).closest('.variable-selector').hasClass('disallowed')) {
      $(this).find(':checkbox').trigger('click');
    }

    e.preventDefault();
    e.stopPropagation();
  });

  $(this._rootElement).on('change', '#units input', function() {
    view_obj._model.updateSelectedUnit($(this).val());
  });

  // generic helper function, used by clear all/select all and individual checkbox changes:
  var updateWithSelectedFields = function() {
    view_obj._model.updateSelectedFields(_.chain(_.map($('#fields input:checked'), function (fieldValue) {
      return {
        value: $(fieldValue).val(),
        field: $(fieldValue).data('field')
      };
    })).groupBy('field').map(function(value, key) {
      return {
        field: key,
        values: _.pluck(value, 'value')
      };
    }).value());
  }

  $(this._rootElement).on('click', '.variable-options button', function(e) {
    var type = $(this).data('type');
    var $options = $(this).closest('.variable-options').find(':checkbox');

    // The clear button can clear all checkboxes.
    if (type == 'clear') {
      $options.prop('checked', false);
    }
    // The select button must only select checkboxes that have data.
    if (type == 'select') {
      $options.parent().not('[data-has-data=false]').find(':checkbox').prop('checked', true)
    }

    updateWithSelectedFields();

    e.stopPropagation();
  });

  $(this._rootElement).on('click', ':checkbox', function(e) {

    // don't permit excluded selections:
    if($(this).parent().hasClass('excluded') || $(this).closest('.variable-selector').hasClass('disallowed')) {
      return;
    }

    updateWithSelectedFields();

    e.stopPropagation();
  });

  $(this._rootElement).on('click', '.variable-selector', function(e) {
    var currentSelector = e.target;

    var currentButton = getCurrentButtonFromCurrentSelector(currentSelector);

    var options = $(this).find('.variable-options');
    var optionsAreVisible = options.is(':visible');
    $(options)[optionsAreVisible ? 'hide' : 'show']();
    currentButton.setAttribute("aria-expanded", optionsAreVisible ? "true" : "false");

    var optionsVisibleAfterClick = options.is(':visible');
    currentButton.setAttribute("aria-expanded", optionsVisibleAfterClick ? "true" : "false");

    e.stopPropagation();
  });

  function getCurrentButtonFromCurrentSelector(currentSelector){
    if(currentSelector.tagName === "H5"){
      return currentSelector.parentElement;
    }
    else if(currentSelector.tagName === "BUTTON"){
      return currentSelector;
    }
  }

  this.initialiseFields = function(args) {
    if(args.fields.length) {
      var template = _.template($("#item_template").html());

      if(!$('button#clear').length) {
        $('<button id="clear" aria-disabled="true" class="disabled">' + translations.indicator.clear_selections + ' <i class="fa fa-remove"></i></button>').insertBefore('#fields');
      }

      $('#fields').html(template({
        fields: args.fields,
        allowedFields: args.allowedFields,
        edges: args.edges
      }));

      $(this._rootElement).removeClass('no-fields');

    } else {
      $(this._rootElement).addClass('no-fields');
    }
  };

  this.initialiseUnits = function(args) {
    var template = _.template($('#units_template').html()),
        units = args.units || [],
        selectedUnit = args.selectedUnit || null;

    $('#units').html(template({
      units: units,
      selectedUnit: selectedUnit
    }));

    if(!units.length) {
      $(this._rootElement).addClass('no-units');
    }
  };

  this.alterChartConfig = function(config, info) {
    opensdg.chartConfigAlterations.forEach(function(callback) {
      callback(config, info);
    });
  };

  this.updateChartTitle = function(chartTitle) {
    if (typeof chartTitle !== 'undefined') {
      $('.chart-title').text(chartTitle);
    }
  }

  this.updatePlot = function(chartInfo) {
    view_obj._chartInstance.data.datasets = chartInfo.datasets;

    if(chartInfo.selectedUnit) {
      view_obj._chartInstance.options.scales.yAxes[0].scaleLabel.labelString = translations.t(chartInfo.selectedUnit);
    }

    // Create a temp object to alter, and then apply. We go to all this trouble
    // to avoid completely replacing view_obj._chartInstance -- and instead we
    // just replace it's properties: "type", "data", and "options".
    var updatedConfig = {
      type: view_obj._chartInstance.type,
      data: view_obj._chartInstance.data,
      options: view_obj._chartInstance.options
    }
    this.alterChartConfig(updatedConfig, chartInfo);
    view_obj._chartInstance.type = updatedConfig.type;
    view_obj._chartInstance.data = updatedConfig.data;
    view_obj._chartInstance.options = updatedConfig.options;

    view_obj._chartInstance.update(1000, true);

    $(this._legendElement).html(view_obj._chartInstance.generateLegend());

    view_obj.updateChartDownloadButton(chartInfo.selectionsTable);
  };



  this.createPlot = function (chartInfo) {

    var that = this;
    var gridColor = that.getGridColor();
    var tickColor = that.getTickColor();

    var chartConfig = {
      type: this._model.graphType,
      data: chartInfo,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        spanGaps: true,
        scrollX: true,
        scrollCollapse: true,
        sScrollXInner: '150%',
        scales: {
          xAxes: [{
            maxBarThickness: 150,
            gridLines: {
              color: gridColor,
            },
            ticks: {
              fontColor: tickColor,
            },
          }],
          yAxes: [{
            gridLines: {
              color: gridColor,
            },
            ticks: {
              suggestedMin: 0,
              fontColor: tickColor,
            },
            scaleLabel: {
              display: this._model.selectedUnit ? translations.t(this._model.selectedUnit) : this._model.measurementUnit,
              labelString: this._model.selectedUnit ? translations.t(this._model.selectedUnit) : this._model.measurementUnit,
              fontColor: tickColor,
            }
          }]
        },
        legendCallback: function(chart) {
            var text = ['<ul id="legend">'];

            _.each(chart.data.datasets, function(dataset, datasetIndex) {
              text.push('<li data-datasetindex="' + datasetIndex + '">');
              text.push('<span class="swatch' + (dataset.borderDash ? ' dashed' : '') + '" style="background-color: ' + dataset.borderColor + '">');
              text.push('</span>');
              text.push(translations.t(dataset.label));
              text.push('</li>');
            });

            text.push('</ul>');
            return text.join('');
        },
        legend: {
          display: false
        },
        title: {
          display: false
        },
        plugins: {
          scaler: {}
        }
      }
    };
    this.alterChartConfig(chartConfig, chartInfo);

    this._chartInstance = new Chart($(this._rootElement).find('canvas'), chartConfig);

    window.addEventListener('contrastChange', function(e) {
      var gridColor = that.getGridColor(e.detail);
      var tickColor = that.getTickColor(e.detail);
      view_obj._chartInstance.options.scales.yAxes[0].scaleLabel.fontColor = tickColor;
      view_obj._chartInstance.options.scales.yAxes[0].gridLines.color = gridColor;
      view_obj._chartInstance.options.scales.yAxes[0].ticks.fontColor = tickColor;
      view_obj._chartInstance.options.scales.xAxes[0].gridLines.color = gridColor;
      view_obj._chartInstance.options.scales.xAxes[0].ticks.fontColor = tickColor;
      view_obj._chartInstance.update();
    });

    Chart.pluginService.register({
      afterDraw: function(chart) {
        var $canvas = $(that._rootElement).find('canvas'),
        font = '12px Arial',
        canvas = $canvas.get(0),
        textRowHeight = 20,
        ctx = canvas.getContext("2d");

        ctx.font = font;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#6e6e6e';
      }
    });

    this.createTableFooter('selectionChartFooter', chartInfo.footerFields, '#chart-canvas');
    this.createDownloadButton(chartInfo.selectionsTable, 'Chart', chartInfo.indicatorId, '#selectionsChart');
    this.createSourceButton(chartInfo.shortIndicatorId, '#selectionsChart');

    $("#btnSave").click(function() {
      var filename = chartInfo.indicatorId + '.png',
          element = document.getElementById('chart-canvas'),
          footer = document.getElementById('selectionChartFooter'),
          height = element.clientHeight + 25 + ((footer) ? footer.clientHeight : 0),
          width = element.clientWidth + 25;
      var options = {
        // These options fix the height, width, and position.
        height: height,
        width: width,
        windowHeight: height,
        windowWidth: width,
        x: 0,
        y: 0,
        scrollX: 0,
        scrollY: 0,
        // Allow a chance to alter the screenshot's HTML.
        onclone: function(clone) {
          // Add a body class so that the screenshot style can be custom.
          clone.body.classList.add('image-download-in-progress');
        },
        // Decide which elements to skip.
        ignoreElements: function(el) {
          // Keep all style, head, and link elements.
          var keepTags = ['STYLE', 'HEAD', 'LINK'];
          if (keepTags.indexOf(el.tagName) !== -1) {
            return false;
          }
          // Keep all elements contained by (or containing) the screenshot
          // target element.
          if (element.contains(el) || el.contains(element)) {
            return false;
          }
          // Leave out everything else.
          return true;
        }
      };
      // First convert the target to a canvas.
      html2canvas(element, options).then(function(canvas) {
        // Then download that canvas as a PNG file.
        canvas.toBlob(function(blob) {
          saveAs(blob, filename);
        });
      });
    });

    $(this._legendElement).html(view_obj._chartInstance.generateLegend());
  };

  this.getGridColor = function(contrast) {
    return this.isHighContrast(contrast) ? '#222' : '#ddd';
  };

  this.getTickColor = function(contrast) {
    return this.isHighContrast(contrast) ? '#fff' : '#000';
  }

  this.isHighContrast = function(contrast) {
    if (contrast) {
      return contrast === 'high';
    }
    else {
      return $('body').hasClass('contrast-high');
    }
  };

  this.toCsv = function (tableData) {
    var lines = [],
    headings = _.map(tableData.headings, function(heading) { return '"' + translations.t(heading) + '"'; });

    lines.push(headings.join(','));

    _.each(tableData.data, function (dataValues) {
      var line = [];

      _.each(headings, function (heading, index) {
        line.push(dataValues[index]);
      });

      lines.push(line.join(','));
    });

    return lines.join('\n');
  };

  var setDataTableWidth = function(table) {
    table.find('thead th').each(function() {
      var textLength = $(this).text().length;
      for(var loop = 0; loop < view_obj._tableColumnDefs.length; loop++) {
        var def = view_obj._tableColumnDefs[loop];
        if(textLength < def.maxCharCount) {
          if(!def.width) {
            $(this).css('white-space', 'nowrap');
          } else {
            $(this).css('width', def.width + 'px');
            $(this).data('width', def.width);
          }
          break;
        }
      }
    });

    table.removeAttr('style width');

    var totalWidth = 0;
    table.find('thead th').each(function() {
      if($(this).data('width')) {
        totalWidth += $(this).data('width');
      } else {
        totalWidth += $(this).width();
      }
    });

    // ascertain whether the table should be width 100% or explicit width:
    var containerWidth = table.closest('.dataTables_wrapper').width();

    if(totalWidth > containerWidth) {
      table.css('width', totalWidth + 'px');
    } else {
      table.css('width', '100%');
    }
  };

  var initialiseDataTable = function(el) {
    var datatables_options = options.datatables_options || {
      paging: false,
      bInfo: false,
      bAutoWidth: false,
      searching: false,
      responsive: false,
      order: [[0, 'asc']]
    }, table = $(el).find('table');

    datatables_options.aaSorting = [];

    table.DataTable(datatables_options);

    setDataTableWidth(table);
  };

  this.createSelectionsTable = function(chartInfo) {
    this.createTable(chartInfo.selectionsTable, chartInfo.indicatorId, '#selectionsTable', true);
    this.createTableFooter('selectionTableFooter', chartInfo.footerFields, '#selectionsTable');
    this.createDownloadButton(chartInfo.selectionsTable, 'Table', chartInfo.indicatorId, '#selectionsTable');
    this.createSourceButton(chartInfo.shortIndicatorId, '#selectionsTable');
  };


  this.createDownloadButton = function(table, name, indicatorId, el) {
    if(window.Modernizr.blobconstructor) {
      var downloadKey = 'download_csv';
      if (name == 'Chart') {
        downloadKey = 'download_chart';
      }
      if (name == 'Table') {
        downloadKey = 'download_table';
      }
      var gaLabel = 'Download ' + name + ' CSV: ' + indicatorId.replace('indicator_', '');
      var tableCsv = this.toCsv(table);
      var fileName = indicatorId + '.csv';
      var downloadButton = $('<a />').text(translations.indicator[downloadKey])
        .attr(opensdg.autotrack('download_data_current', 'Downloads', 'Download CSV', gaLabel))
        .attr({
          'download': fileName,
          'title': translations.indicator.download_csv_title,
          'class': 'btn btn-primary btn-download',
          'tabindex': 0
        });
      var blob = new Blob([tableCsv], {
        type: 'text/csv'
      });
      if (window.navigator && window.navigator.msSaveBlob) {
        // Special behavior for IE.
        downloadButton.on('click.openSdgDownload', function(event) {
          window.navigator.msSaveBlob(blob, fileName);
        });
      }
      else {
        downloadButton
          .attr('href', URL.createObjectURL(blob))
          .data('csvdata', tableCsv);
      }
      if (name == 'Chart') {
        this._chartDownloadButton = downloadButton;
      }
      $(el).append(downloadButton);
    } else {
      var headlineId = indicatorId.replace('indicator', 'headline');
      var id = indicatorId.replace('indicator_', '');
      var gaLabel = 'Download Headline CSV: ' + id;
      $(el).append($('<a />').text(translations.indicator.download_headline)
      .attr(opensdg.autotrack('download_data_headline', 'Downloads', 'Download CSV', gaLabel))
      .attr({
        'href': opensdg.remoteDataBaseUrl + '/headline/' + id + '.csv',
        'download': headlineId + '.csv',
        'title': translations.indicator.download_headline_title,
        'class': 'btn btn-primary btn-download',
        'tabindex': 0
      }));
    }
  }

  this.updateChartDownloadButton = function(table) {
    if (typeof this._chartDownloadButton !== 'undefined') {
      var tableCsv = this.toCsv(table);
      var blob = new Blob([tableCsv], {
        type: 'text/csv'
      });
      var fileName = this._chartDownloadButton.attr('download');
      if (window.navigator && window.navigator.msSaveBlob) {
        // Special behavior for IE.
        this._chartDownloadButton.off('click.openSdgDownload')
        this._chartDownloadButton.on('click.openSdgDownload', function(event) {
          window.navigator.msSaveBlob(blob, fileName);
        });
      }
      else {
        this._chartDownloadButton
          .attr('href', URL.createObjectURL(blob))
          .data('csvdata', tableCsv);
      }
    }
  }

  this.createSourceButton = function(indicatorId, el) {
    var gaLabel = 'Download Source CSV: ' + indicatorId;
    $(el).append($('<a />').text(translations.indicator.download_source)
    .attr(opensdg.autotrack('download_data_source', 'Downloads', 'Download CSV', gaLabel))
    .attr({
      'href': opensdg.remoteDataBaseUrl + '/data/' + indicatorId + '.csv',
      'download': indicatorId + '.csv',
      'title': translations.indicator.download_source_title,
      'class': 'btn btn-primary btn-download',
      'tabindex': 0
    }));
  }

  this.createTable = function(table, indicatorId, el) {

    options = options || {};
    var that = this,
    table_class = options.table_class || 'table table-hover';

    // clear:
    $(el).html('');

    if(table && table.data.length) {
      var currentTable = $('<table />').attr({
        'class': table_class,
        'width': '100%'
      });

      currentTable.append('<caption>' + that._model.chartTitle + '</caption>');

      var table_head = '<thead><tr>';

      var getHeading = function(heading, index) {
        var span = '<span class="sort" />';
        var span_heading = '<span>' + translations.t(heading) + '</span>';
        return (!index || heading.toLowerCase() == 'units') ? span_heading + span : span + span_heading;
      };

      table.headings.forEach(function (heading, index) {
        table_head += '<th' + (!index || heading.toLowerCase() == 'units' ? '': ' class="table-value"') + ' scope="col">' + getHeading(heading, index) + '</th>';
      });

      table_head += '</tr></thead>';
      currentTable.append(table_head);
      currentTable.append('<tbody></tbody>');

      table.data.forEach(function (data) {
        var row_html = '<tr>';
        table.headings.forEach(function (heading, index) {
          // For accessibility set the Year column to a "row" scope th.
          var isYear = (index == 0 || heading.toLowerCase() == 'year');
          var isUnits = (heading.toLowerCase() == 'units');
          var cell_prefix = (isYear) ? '<th scope="row"' : '<td';
          var cell_suffix = (isYear) ? '</th>' : '</td>';
          row_html += cell_prefix + (isYear || isUnits ? '' : ' class="table-value"') + '>' + (data[index] !== null ? data[index] : '-') + cell_suffix;
        });
        row_html += '</tr>';
        currentTable.find('tbody').append(row_html);
      });

      $(el).append(currentTable);

      // initialise data table
      initialiseDataTable(el);

    } else {
      $(el).append($('<p />').text('There is no data for this breakdown.'));
    }
  };

  this.createTableFooter = function(divid, footerFields, el) {
    var footdiv = $('<div />').attr({
      'id': divid,
      'class': 'table-footer-text'
    });

    _.each(footerFields, function(val, key) {
      footdiv.append($('<p />').text(key + ': ' + val));
    });

    $(el).append(footdiv);
  };


  this.sortFieldGroup = function(fieldGroupElement) {
    var sortLabels = function(a, b) {
      var aObj = { hasData: $(a).attr('data-has-data'), text: $(a).text() };
      var bObj = { hasData: $(b).attr('data-has-data'), text: $(b).text() };
      if (aObj.hasData == bObj.hasData) {
        return (aObj.text > bObj.text) ? 1 : -1;
      }
      return (aObj.hasData < bObj.hasData) ? 1 : -1;
    };
    fieldGroupElement.find('label')
    .sort(sortLabels)
    .appendTo(fieldGroupElement.find('#indicatorData .variable-options'));
  }
};
