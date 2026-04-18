const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const Razorpay = require("razorpay");
const crypto = require("crypto");
require("dotenv").config();

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000', // Change to your frontend URL in production
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================== MongoDB ==================
const mongoUrl = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/starphone";

if (!process.env.MONGO_URL) {
  console.warn("MONGO_URL is not set. Falling back to local MongoDB.");
}

mongoose.connect(mongoUrl, {
  serverSelectionTimeoutMS: 10000
})
  .then(() => {
    console.log("MongoDB Connected");
    initializeAdmins();
  })
  .catch(err => {
    console.error("MongoDB connection error:", err.message);
    console.error(err);
  });

// ================== Razorpay ==================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ================== Schemas ==================

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  phonenumber: String,
  address: String,
  role: { type: String, default: "user" }

});

const User = mongoose.model("User", userSchema);

const productSchema = new mongoose.Schema({
  name: String,
  brand: String,              
  price: Number,              
  ram: String,                
  storage: String,            
  image: String,
  details: String,
  description: String,
  features: [String]
});

const Product = mongoose.model("Product", productSchema);

const cartSchema = new mongoose.Schema({
  username: String,
  email: String,
  phonenumber: String,
  address: String,
  phonename: String,
  phonedetails: String,
  price: Number,
  quantity: Number,
  image: String
});

const Cart = mongoose.model("Cart", cartSchema);

const orderSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true
  },

  email: {
    type: String,
    required: true,
    lowercase: true
  },

  phonenumber: {
    type: String,
    required: true
  },

  address: {
    type: String,
    required: true
  },

  total: {
    type: Number,
    required: true,
    default: 0
  },

  items: {
    type: [
      {
        phonename: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        image: { type: String }
      }
    ],
    default: []
  },

  paymentId: {
    type: String
  },

  status: {
    type: String,
    enum: ["Pending", "Paid", "Processing", "Delivered", "Failed"],
    default: "Pending"
  },

  date: {
    type: Date,
    default: Date.now
  }

}, { timestamps: true }); 

const Order = mongoose.model("Order", orderSchema);

// ================== Admin Init ==================
async function initializeAdmins() {
  const admins = [
    { email: "addhruvil@gmail.com", password: "2005", name: "Admin Dhruvil" },
    { email: "adgaurav@gmail.com", password: "2005", name: "Admin Gaurav" }
  ];

  for (const admin of admins) {
    const existing = await User.findOne({ email: admin.email });

    if (!existing) {
      await new User({ ...admin, role: "admin" }).save();
      console.log(`Admin created: ${admin.email}`);
    }
  }
}

// ================== AUTH ==================
app.post("/register", async (req, res) => {
  try {
    const { name, email, password, phonenumber } = req.body;

    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ message: "Request body is missing or invalid JSON" });
    }

    if (await User.findOne({ email }))
      return res.status(400).json({ message: "Email already registered" });

    await new User({ name, email, password, phonenumber }).save();
    res.json({ message: "User Registered Successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error registering user", error: err.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user) return res.status(400).json({ message: "User not found" });
    if (user.password !== req.body.password)
      return res.status(400).json({ message: "Invalid password" });

    res.json({
      message: "Login successful",
      user,
      token: "fake-token"
    });

  } catch {
    res.status(500).json({ message: "Error logging in" });
  }
});

// ================== CART ==================
app.post('/add-to-cart', async (req, res) => {
  try {
    const { email, phonename, quantity } = req.body;

    let item = await Cart.findOne({ email, phonename });

    if (item) {
      item.quantity += Number(quantity);
      await item.save();
    } else {
      await new Cart(req.body).save();
    }

    res.json({ message: "Added to cart" });

  } catch {
    res.status(500).json({ message: "Error adding to cart" });
  }
});

app.get('/cart/:email', async (req, res) => {
  res.json(await Cart.find({ email: req.params.email }));
});

app.delete('/cart/remove/:id', async (req, res) => {
  await Cart.findByIdAndDelete(req.params.id);
  res.json({ message: "Item removed" });
});

// ================== HEALTH CHECK ==================
app.get('/', (_req, res) => {
  res.json({ status: "OK", message: "Starphone backend running" });
});

// ================== PRODUCTS ==================
app.post('/products', async (req, res) => {
  res.json(await new Product(req.body).save());
});
app.delete('/products/:id', async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting product" });
  }
});

// Explicit route to fetch all products
app.get('/products/all', async (_req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: "Error fetching products" });
  }
});

app.get('/products', async (req, res) => {
  try {
    const { search, brand, minPrice, maxPrice, ram, storage } = req.query;

    let filter = {};

    // 🔍 Search by name
    if (search) {
      filter.name = { $regex: search, $options: "i" }; // case-insensitive
    }

    // 📱 Brand filter
    if (brand) {
      filter.brand = brand;
    }

    // 💰 Price filter
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    // ⚡ RAM filter
    if (ram) {
      filter.ram = ram;
    }

    // 💾 Storage filter
    if (storage) {
      filter.storage = storage;
    }

    const products = await Product.find(filter);
    res.json(products);

  } catch (err) {
    res.status(500).json({ message: "Error fetching products" });
  }
});

// ================== UPDATE PRODUCT ==================
app.put('/products/:id', async (req, res) => {
  try {
    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedProduct) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json({ message: "Product updated", product: updatedProduct });
  } catch {
    res.status(500).json({ message: "Error updating product" });
  }
});
// ================== UPDATE USER ==================
app.put("/update-profile", async (req, res) => {
  try {
    const { name, email, phonenumber } = req.body;

    const user = await User.findOneAndUpdate(
      { email },
      { name, phonenumber },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Profile updated successfully",
      user
    });

  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ================== DELETE USER (ADMIN) ==================
app.delete('/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting user" });
  }
});

// ================== CHANGE PASSWORD ==================
app.put("/change-password", async (req, res) => {
  try {
    const { email, oldPassword, newPassword } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.password !== oldPassword) {
      return res.status(400).json({ message: "Old password is incorrect" });
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: "Password changed successfully" });

  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

//=================== phone details ==================
app.get("/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(product);

  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ================== RAZORPAY ==================
app.post("/create-order", async (req, res) => {
  try {
    const { total } = req.body;

    const order = await razorpay.orders.create({
      amount: total * 100,
      currency: "INR",
      receipt: "order_" + Date.now()
    });

    res.json(order);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Razorpay error" });
  }
});

// ================== VERIFY PAYMENT ==================
app.post("/verify-payment", async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    userData
  } = req.body;

  const body = razorpay_order_id + "|" + razorpay_payment_id;

  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  if (expected === razorpay_signature) {

    // Save Order AFTER payment success
  await new Order({
  username: userData.username,
  email: userData.email,
  phonenumber: userData.phonenumber,
  address: userData.address,
  total: userData.total,

  // ✅ FIX HERE
  items: userData.items || [],

  paymentId: razorpay_payment_id,
  status: "Paid",
  orderId: "ORD" + Date.now()
}).save();
console.log("USER DATA:", userData);

    await Cart.deleteMany({ email: userData.email });

    res.json({ success: true });

  } else {
    res.status(400).json({ success: false });
  }
});

// ================== ORDERS ==================
app.get('/orders', async (req, res) => {
  res.json(await Order.find());
});

app.get('/orders/user/:email', async (req, res) => {
  res.json(await Order.find({ email: req.params.email }));
});

app.put('/orders/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    res.json({ message: "Order updated", order });
  } catch (err) {
    res.status(500).json({ message: "Error updating order" });
  }
});

// ================== USERS ==================
app.get('/users', async (req, res) => {
  res.json(await User.find());
});

// ================== SERVER ==================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
