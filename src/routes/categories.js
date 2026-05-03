const express = require("express");
const router = express.Router();

const CATEGORIES = [
  { value: "restaurant", label: "Restaurants", icon: "🍽️" },
  { value: "cafe", label: "Cafés & Coffee Shops", icon: "☕" },
  { value: "bar", label: "Bars & Pubs", icon: "🍺" },
  { value: "bakery", label: "Bakeries", icon: "🥐" },
  { value: "gym", label: "Gyms & Fitness", icon: "💪" },
  { value: "beauty_salon", label: "Beauty Salons", icon: "💇" },
  { value: "hair_care", label: "Hair & Barber", icon: "✂️" },
  { value: "spa", label: "Spas & Wellness", icon: "🧖" },
  { value: "hospital", label: "Hospitals", icon: "🏥" },
  { value: "doctor", label: "Doctors & Clinics", icon: "👨‍⚕️" },
  { value: "dentist", label: "Dentists", icon: "🦷" },
  { value: "pharmacy", label: "Pharmacies", icon: "💊" },
  { value: "school", label: "Schools", icon: "🏫" },
  { value: "university", label: "Universities", icon: "🎓" },
  { value: "lodging", label: "Hotels & Lodging", icon: "🏨" },
  { value: "shopping_mall", label: "Shopping Malls", icon: "🛍️" },
  { value: "clothing_store", label: "Clothing Stores", icon: "👕" },
  { value: "electronics_store", label: "Electronics", icon: "📱" },
  { value: "furniture_store", label: "Furniture", icon: "🪑" },
  { value: "jewelry_store", label: "Jewellery", icon: "💎" },
  { value: "car_dealer", label: "Car Dealers", icon: "🚗" },
  { value: "car_repair", label: "Car Repair", icon: "🔧" },
  { value: "gas_station", label: "Petrol Pumps", icon: "⛽" },
  { value: "bank", label: "Banks", icon: "🏦" },
  { value: "atm", label: "ATMs", icon: "💳" },
  { value: "real_estate_agency", label: "Real Estate", icon: "🏠" },
  { value: "lawyer", label: "Lawyers", icon: "⚖️" },
  { value: "travel_agency", label: "Travel Agencies", icon: "✈️" },
  { value: "laundry", label: "Laundry", icon: "👔" },
  { value: "supermarket", label: "Supermarkets", icon: "🛒" },
  { value: "movie_theater", label: "Cinemas", icon: "🎬" },
  { value: "place_of_worship", label: "Places of Worship", icon: "🛕" },
];

router.get("/", (req, res) => {
  const { search } = req.query;
  let filtered = CATEGORIES;
  if (search) {
    const q = search.toLowerCase();
    filtered = CATEGORIES.filter(c => c.label.toLowerCase().includes(q) || c.value.includes(q));
  }
  res.json({ categories: filtered });
});

module.exports = router;
