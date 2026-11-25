      /* ========================================================================
         A. STOCKAGE EN MÉMOIRE SÉCURISÉ
         ======================================================================== */
      var memoryStorage = {};
      function safeGet(key) {
        if (Object.prototype.hasOwnProperty.call(memoryStorage, key)) {
          return memoryStorage[key];
        }
        try {
          var vLocal = window.localStorage.getItem(key);
          if (vLocal !== null) return vLocal;
        } catch (e) {}
        try {
          var vSession = window.sessionStorage.getItem(key);
          if (vSession !== null) return vSession;
        } catch (e) {}
        return null;
      }
      function safeSet(key, val) {
        var strVal = String(val);
        memoryStorage[key] = strVal;
        try {
          window.localStorage.setItem(key, strVal);
        } catch (e) {}
        try {
          window.sessionStorage.setItem(key, strVal);
        } catch (e) {}
      }
      function safeRemove(key) {
        delete memoryStorage[key];
        try {
          window.localStorage.removeItem(key);
        } catch (e) {}
        try {
          window.sessionStorage.removeItem(key);
        } catch (e) {}
      }
