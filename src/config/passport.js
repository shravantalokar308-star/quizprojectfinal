const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
    proxy: true
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // 1. Check if user already exists with this googleId
      let user = await User.findOne({ googleId: profile.id });
      
      if (user) {
        return done(null, user);
      }

      // 2. If not, check if user exists with the same email
      const email = profile.emails[0].value;
      user = await User.findOne({ email });

      if (user) {
        // Link google account to existing local account
        user.googleId = profile.id;
        await user.save();
        return done(null, user);
      }

      // 3. Create new user if they don't exist
      const newUser = new User({
        username: profile.displayName || profile.emails[0].value.split('@')[0],
        email: email,
        googleId: profile.id,
        // No password needed
      });

      await newUser.save();
      done(null, newUser);
    } catch (err) {
      console.error('Error in Google Strategy:', err);
      done(err, null);
    }
  }
));

// We don't use sessions since we use JWT, but passport requires these
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;
