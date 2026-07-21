"""Configuración de donaciones (PayPal.me).

Todo el mundo usa PayPal: los botones muestran montos redondeados en la moneda
local del sistema y abren https://paypal.me/<usuario>/<monto><MONEDA> (PayPal
convierte a la moneda de tu cuenta). El usuario puede cambiar la moneda con el
selector del propio mensaje.

Solo hace falta tu usuario de PayPal.me aquí. Los montos y monedas sugeridos se
definen en la interfaz (static/app.js → CURRENCIES). La firma aparece bajo el
refrán del mensaje de apoyo.
"""

SIGNATURE = "Philippe Prince Tritto"
PAYPAL_ME = "philippetritto"

DONATION = {
    "signature": SIGNATURE,
    "paypal_me": PAYPAL_ME,
}
