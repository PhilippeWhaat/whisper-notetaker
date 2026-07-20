"""Configuración de donaciones (MercadoPago).

Cómo rellenar esto:
1. Entra a tu panel de MercadoPago → "Link de pago" / "Cobrar".
2. Crea UN link de pago por cada monto sugerido (5, 10, 20) con ese importe
   fijo. Copia cada URL y pégala abajo en el campo "url" correspondiente.
3. (Opcional) Crea un link de monto variable —donde el que paga escribe la
   cantidad— y pégalo en CUSTOM_URL para el botón "Otro monto".
4. Ajusta CURRENCY_SYMBOL si tu cuenta cobra en otra moneda ($, MX$, AR$…).

Mientras los "url" estén vacíos, la app no mostrará el mensaje de donación al
inicio (no tiene sentido pedir dinero sin destino) y el botón de café avisará
de que aún no está configurado. En cuanto pegues al menos un link, todo se
activa. Los importes son solo etiquetas visuales; el cobro real lo define el
link de MercadoPago que pegues.
"""

CURRENCY_SYMBOL = "$"

DONATION = {
    "currency_symbol": CURRENCY_SYMBOL,
    "options": [
        {"amount": 5,  "url": ""},   # ← pega aquí tu link de MercadoPago de 5
        {"amount": 10, "url": ""},   # ← pega aquí tu link de MercadoPago de 10
        {"amount": 20, "url": ""},   # ← pega aquí tu link de MercadoPago de 20
    ],
    # Link de monto variable (opcional). Si lo dejas vacío, no aparece el botón.
    "custom_url": "",
}
