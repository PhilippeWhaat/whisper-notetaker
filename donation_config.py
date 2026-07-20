"""Configuración de donaciones.

Dos perfiles según la región del sistema:
- México (locale del sistema es-MX): MercadoPago, montos fijos en pesos.
  Un "link de pago" por monto (creados en tu panel de MercadoPago).
- Resto del mundo: Ko-fi. Ko-fi NO permite prefijar el monto por URL, así
  que se muestra un solo botón y el donante elige la cantidad en Ko-fi
  (puedes fijar montos sugeridos en el panel de Ko-fi).

La firma aparece bajo el refrán del mensaje de apoyo (tu nombre, el mismo que
ven en MercadoPago / Ko-fi).
"""

SIGNATURE = "Philippe Prince Tritto"

DONATION = {
    "signature": SIGNATURE,

    # México (sistema es-MX): MercadoPago en pesos.
    "mx": {
        "currency_symbol": "MX$",
        "options": [
            {"amount": 100, "url": "https://mpago.la/14cZKwB"},  # ~5 USD
            {"amount": 200, "url": "https://mpago.la/1oKDjC9"},  # ~10 USD
            {"amount": 400, "url": "https://mpago.la/24XgiDF"},  # ~20 USD
        ],
    },

    # Resto del mundo: PayPal.me con montos prefijados en la URL
    # (https://paypal.me/<usuario>/<monto><moneda>, p. ej. .../10USD).
    # Si "paypal_me" está vacío, se usa "kofi" (un solo botón, el donante
    # elige el monto en Ko-fi).
    "intl": {
        "currency_symbol": "$",
        "currency_code": "USD",
        "amounts": [5, 10, 20],
        "paypal_me": "philippetritto",
        "kofi": "https://ko-fi.com/philippeprince",
    },
}
