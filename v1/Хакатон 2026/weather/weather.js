// weather.js — погода через Open-Meteo (бесплатно, без ключа и регистрации).
// Работает и в браузере, и в Node.js 18+ (используется встроенный fetch).

const WMO = {
  0: "Ясно", 1: "Преимущественно ясно", 2: "Переменная облачность", 3: "Пасмурно",
  45: "Туман", 48: "Изморозь",
  51: "Лёгкая морось", 53: "Морось", 55: "Сильная морось",
  56: "Ледяная морось", 57: "Сильная ледяная морось",
  61: "Небольшой дождь", 63: "Дождь", 65: "Сильный дождь",
  66: "Ледяной дождь", 67: "Сильный ледяной дождь",
  71: "Небольшой снег", 73: "Снег", 75: "Сильный снег", 77: "Снежные зёрна",
  80: "Ливень", 81: "Сильный ливень", 82: "Очень сильный ливень",
  85: "Снегопад", 86: "Сильный снегопад",
  95: "Гроза", 96: "Гроза с градом", 99: "Сильная гроза с градом",
};

const describeCode = (code) => WMO[code] ?? `Код ${code}`;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ошибка запроса ${res.status}: ${url}`);
  return res.json();
}

// Поиск координат по названию города
async function findCity(name) {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?count=1&language=ru&name=" +
    encodeURIComponent(name);
  const data = await getJson(url);
  if (!data.results || !data.results.length) throw new Error(`Город не найден: ${name}`);
  const c = data.results[0];
  return { name: c.name, country: c.country, lat: c.latitude, lon: c.longitude };
}

// Текущая погода
async function getCurrentWeather(lat, lon) {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m," +
    "precipitation,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl" +
    "&wind_speed_unit=ms&timezone=auto";
  const { current } = await getJson(url);
  return {
    time: current.time,
    temperature: current.temperature_2m,
    feelsLike: current.apparent_temperature,
    humidity: current.relative_humidity_2m,
    precipitation: current.precipitation,
    windSpeed: current.wind_speed_10m,          // м/с
    windDirection: current.wind_direction_10m,  // градусы
    pressure: Math.round(current.pressure_msl * 0.750062), // мм рт. ст.
    description: describeCode(current.weather_code),
  };
}

// Долгосрочный прогноз: по дням, до 16 дней
async function getForecast(lat, lon, days = 16) {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lon}` +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min," +
    "precipitation_sum,precipitation_probability_max,wind_speed_10m_max" +
    `&wind_speed_unit=ms&timezone=auto&forecast_days=${Math.min(days, 16)}`;
  const { daily } = await getJson(url);
  return daily.time.map((date, i) => ({
    date,
    description: describeCode(daily.weather_code[i]),
    tempMax: daily.temperature_2m_max[i],
    tempMin: daily.temperature_2m_min[i],
    precipitation: daily.precipitation_sum[i],              // мм
    precipitationProbability: daily.precipitation_probability_max[i], // %
    windMax: daily.wind_speed_10m_max[i],                   // м/с
  }));
}

// Всё сразу по названию города
async function getWeatherByCity(cityName, days = 16) {
  const city = await findCity(cityName);
  const [current, forecast] = await Promise.all([
    getCurrentWeather(city.lat, city.lon),
    getForecast(city.lat, city.lon, days),
  ]);
  return { city, current, forecast };
}

// Для Node.js и для браузера
if (typeof module !== "undefined") {
  module.exports = { findCity, getCurrentWeather, getForecast, getWeatherByCity, describeCode };
}

// Запуск из консоли: node weather.js Москва
if (typeof require !== "undefined" && require.main === module) {
  const cityName = process.argv[2] || "Москва";
  getWeatherByCity(cityName)
    .then(({ city, current, forecast }) => {
      console.log(`\n${city.name}, ${city.country}`);
      console.log(
        `Сейчас: ${current.temperature}°C (ощущается ${current.feelsLike}°C), ` +
        `${current.description}, ветер ${current.windSpeed} м/с, ` +
        `влажность ${current.humidity}%, давление ${current.pressure} мм рт. ст.\n`
      );
      console.log("Прогноз:");
      forecast.forEach((d) =>
        console.log(
          `${d.date}: ${d.tempMin}…${d.tempMax}°C, ${d.description}, ` +
          `осадки ${d.precipitation} мм (${d.precipitationProbability ?? "—"}%)`
        )
      );
    })
    .catch((e) => console.error("Ошибка:", e.message));
}
