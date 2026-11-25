      /* ========================================================================
         O. INITIALISATION IMMÉDIATE & DRAG-AND-DROP
         ======================================================================== */
      function setupDropZone(zoneId, onFileCallback) {
        var zone = document.getElementById(zoneId);
        if (!zone) return;
        zone.addEventListener('dragover', function (e) {
          e.preventDefault();
          zone.classList.add('border-[#6C2BD9]', 'bg-[#F3EBFF]/60');
        });
        zone.addEventListener('dragleave', function () {
          zone.classList.remove('border-[#6C2BD9]', 'bg-[#F3EBFF]/60');
        });
        zone.addEventListener('drop', function (e) {
          e.preventDefault();
          zone.classList.remove('border-[#6C2BD9]', 'bg-[#F3EBFF]/60');
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            if (zoneId === 'dropZoneMain') {
              chargerPlusieursFichiersPrincipaux(e.dataTransfer.files);
            } else {
              onFileCallback(e.dataTransfer.files[0]);
            }
          }
        });
      }
