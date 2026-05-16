/**
 * \file NormalizeAlbumArt.qml
 * Normalize embedded cover art: resize images larger than 500x500 pixels and
 * convert any non-JPEG format to non-progressive JPEG. Qt's JPEG writer
 * produces non-progressive output by default, so re-encoding also fixes
 * progressive JPEGs.
 *
 * Based on ResizeAlbumArt.qml from the Kid3 project.
 * Original author: Urs Fleisch, 28 Feb 2015
 * Copyright (C) 2015-2017  Urs Fleisch
 * Modified for tag-me-if-you-can.
 *
 * Licensed under the GNU Lesser General Public License v3.
 */

import Kid3 1.1

Kid3Script {
  onRun: {
    var maxPixels = 500

    function doWork() {
      if (app.selectionInfo.tag(Frame.Tag_2).tagFormat) {
        var data = app.getPictureData()
        if (script.getDataSize(data) !== 0) {
          // Try specific formats first; fall back to "" for Qt auto-detection
          // (handles malformed/headerless images stored by some taggers).
          var formats = ["jpg", "png", "webp", ""]
          for (var fmt in formats) {
            var format = formats[fmt]
            var img = script.dataToImage(data, format)
            var imgProps = script.imageProperties(img)
            if ("width" in imgProps) {
              var width = imgProps.width, height = imgProps.height
              var needsResize = width > maxPixels || height > maxPixels
              var needsConvert = format !== "jpg"

              if (needsResize || needsConvert) {
                if (needsResize) {
                  if (width >= height) {
                    width = maxPixels; height = -1
                  } else {
                    width = -1; height = maxPixels
                  }
                  img = script.scaleImage(img, width, height)
                  imgProps = script.imageProperties(img)
                }
                data = script.dataFromImage(img, "jpg")
                if (script.getDataSize(data) !== 0) {
                  app.setPictureData(data)
                  console.log("Normalized image to %1x%2 (%3→jpg) in %4".
                              arg(imgProps.width).arg(imgProps.height).arg(format).
                              arg(app.selectionInfo.fileName))
                }
              }
              break
            }
          }
        }
      }
      if (!nextFile()) {
        if (isStandalone()) {
          app.saveDirectory()
        }
        Qt.quit()
      } else {
        setTimeout(doWork, 1)
      }
    }

    firstFile()
    doWork()
  }
}
