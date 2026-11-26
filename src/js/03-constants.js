      /* ========================================================================
         C. STRUCTURE CIBLE DES 109 COLONNES & CONSTANTES MÉTIER
         ======================================================================== */
      var TARGET_HEADERS = [
        'Country', 'city', 'Area', 'Area.1', 'région', 'commercial', 'order day', 'Mois', 'Shift', "tp d'accep",
        "tp d'assig", 'tp de prepar', 'trajet', 'tp de liv', 'order time', 'Accepted', 'Accepted Time', 'delivered day',
        'delivered at', 'delivery time(M)', 'cancelled at', 'cancellation time (Mins)', 'order id', 'Payment Method',
        'Konnect', 'Wallet', 'Pblm de paiement', 'Transaction ID', 'customer Name', 'customer Phone', 'customer email',
        'customer address', 'Customer second address', 'Restaurant ID', 'restaurant name', 'Chaine', 'Perdue',
        'restaurant phone', 'restaurant area', 'restaurant address', 'services', 'status', 'Cancelled BY', 'driver name',
        'Driver Type', 'driver Phone', 'vehicle type', 'item total', 'driver assigned time', 'picked up time',
        'base de paiement', 'Distance travel', 'kilo', 'à payer réduits', 'à payer kilo', 'total à payer',
        'original delivery amount', 'delivery amount', 'Driver payout HT', 'Driver tax', 'driver payout',
        'driver commission', 'amount to restaurant', 'type de facture', 'commission ca', 'CA', 'item total.1',
        'Total Food', "chiffre d'affaire restaurant", 'Total Food VF', 'restaurant commission', 'restaurant commission before discount',
        'Adjustment', 'returned Earning', 'service charge', 'tax', 'coupon', 'coupon vf', 'coupon type', 'discount type',
        'coupon discount', 'Total Food.1', 'cancellation reason', 'cancellation reason VF', 'admin earnings',
        'Yassir+ Subscription Fee', 'Refunded', 'final earnings', 'returned', 'coupon admin', 'coupon restaurant',
        'Discount Amount', 'Discount Type', 'Night fare', 'Time Taken', 'Food Category', 'Food Item', 'Accepted By',
        'Assigned By', 'Rejection logs', 'Bonus Amount', 'Total Driver Payout', 'Tags', 'Discount Type Provider',
        'Driver Rating', 'Restaurant Rating', 'Driver Adjustment Amount', 'Driver Adjustment Reason', 'Driver Adjustment Category',
        // Colonnes client Kool (lues par le normaliseur Data Kool : « ID Client » col. F, « New Client » col. AG) :
        // ajoutées en FIN de liste pour ne pas décaler les indices des 109 colonnes existantes.
        'customer id', 'new client'
      ];

      var KEY_HEADERS = [
        'Portefeuille AM', 'order day', 'order id', 'restaurant name', 'services', 'status',
        "tp d'accep", "tp d'assig", "tp de prepar",
        'original delivery amount', 'delivery amount', 'à payer réduits',
        'Total Food', 'coupon admin', 'coupon restaurant', 'Total Food VF',
        'coupon discount', 'Discount Amount', 'Discount Type Provider',
        "chiffre d'affaire restaurant", 'amount to restaurant', 'commission ca', 'CA',
        'cancellation reason VF'
      ];

      var NUMERIC_COLS = new Set([
        'item total', 'item total.1', 'Total Food', 'Total Food.1',
        'original delivery amount', 'delivery amount', 'new client'
      ]);

      var DATE_COLS = new Set(['order day', 'delivered day']);

      var TIME_FORMAT_COLS = new Set([
        'order time', 'Accepted', 'Accepted Time', 'delivered at', 'cancelled at',
        'driver assigned time', 'picked up time', 'Ready by Restaurant',
        "tp d'accep", "tp d'assig", 'tp de prepar', 'trajet', 'tp de liv'
      ]);

      var DECIMAL_FORMAT_COLS = new Set([
        'item total', 'item total.1', 'Total Food', 'Total Food.1',
        'Total Food VF', "chiffre d'affaire restaurant", 'CA',
        'à payer réduits', 'original delivery amount', 'delivery amount', 'commission ca'
      ]);

      var COMPUTED_COLS = new Set([
        "tp d'accep", "tp d'assig", 'tp de prepar', 'à payer réduits',
        "chiffre d'affaire restaurant", 'Total Food VF', 'CA', 'commission ca',
        'cancellation reason VF'
      ]);

      var OFFRES_HEADERS = [
        'Portefeuille AM',
        'Area',
        'Nom du restaurant',
        'Total Offres',
        'Discount Article',
        'Promo Admin',
        'Promo Restaurant'
      ];

      // Colonnes exactes de la formule VSTACK / QUERY Stat
      var STAT_HEADERS = [
        'Portefeuille AM',
        'Area',
        'Restaurant',
        'Requested',
        'Delivered',
        'Success Rate',
        'AcceptedByRestaurant',
        'Taux Acceptation',
        'CancelledByRestaurant',
        'Taux Cancellation',
        'GMV',
        'AOV',
        'Commission',
        'Promo Restaurant',
        'Promo Admin',
        'LR_LG_Costs',
        '% Global Delivered'
      ];
