const express = require("express");
const router = express.Router();

const CATEGORIES = [
  { value: "restaurant", label: "Restaurants" },
  { value: "cafe", label: "Cafés & Coffee Shops" },
  { value: "bar", label: "Bars & Pubs" },
  { value: "bakery", label: "Bakeries" },
  { value: "gym", label: "Gyms & Fitness" },
  { value: "beauty_salon", label: "Beauty Salons" },
  { value: "hair_care", label: "Hair & Barber" },
  { value: "spa", label: "Spas & Wellness" },
  { value: "hospital", label: "Hospitals" },
  { value: "doctor", label: "Doctors & Clinics" },
  { value: "dentist", label: "Dentists" },
  { value: "pharmacy", label: "Pharmacies" },
  { value: "school", label: "Schools" },
  { value: "university", label: "Universities" },
  { value: "lodging", label: "Hotels & Lodging" },
  { value: "shopping_mall", label: "Shopping Malls" },
  { value: "clothing_store", label: "Clothing Stores" },
  { value: "electronics_store", label: "Electronics" },
  { value: "furniture_store", label: "Furniture" },
  { value: "jewelry_store", label: "Jewellery" },
  { value: "car_dealer", label: "Car Dealers" },
  { value: "car_repair", label: "Car Repair" },
  { value: "gas_station", label: "Petrol Pumps" },
  { value: "bank", label: "Banks" },
  { value: "atm", label: "ATMs" },
  { value: "real_estate_agency", label: "Real Estate" },
  { value: "lawyer", label: "Lawyers" },
  { value: "travel_agency", label: "Travel Agencies" },
  { value: "laundry", label: "Laundry" },
  { value: "supermarket", label: "Supermarkets" },
  { value: "movie_theater", label: "Cinemas" },
  { value: "place_of_worship", label: "Places of Worship" },
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
