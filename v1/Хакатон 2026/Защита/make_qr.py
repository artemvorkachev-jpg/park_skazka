# -*- coding: utf-8 -*-
"""Новый QR-код на прототип: python make_qr.py https://адрес-игры  (нужен пакет segno: pip install segno)."""
import os, sys
import segno
if len(sys.argv) < 2:
    sys.exit('Укажите адрес: python make_qr.py https://адрес-игры')
media = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'Команда — Хранитель Сказки', 'media')
segno.make(sys.argv[1], error='m').save(os.path.join(media, 'qr-game.svg'), scale=10, border=2, dark='#0B2233', light='#FFFFFF')
open(os.path.join(media, 'qr-game-url.txt'), 'w', encoding='utf-8').write(sys.argv[1] + '\n')
print('Готово. Не забудьте заменить адрес и в кнопке «Попробовать» в index.html (блок 4).')
