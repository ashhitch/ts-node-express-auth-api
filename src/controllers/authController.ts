import './../handlers/passport';

import * as mail from './../handlers/mail';

import { AuthToken, default as User, UserModel } from '../models/User';
import { NextFunction, Request, Response } from 'express';

import { SECRET } from './../helpers';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import passport from 'passport';
import { promisify } from 'es6-promisify';

export const login =  (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate('local', {session: false}, (err, user, info) => {
        if (err || !user) {
            return res.status(400).json({
                message: 'Something is not right',
                user   : user
            });
        }
       req.login(user, {session: false}, (err) => {
           if (err) {
               res.send(err);
           }
           // generate a signed son web token with the contents of user object and return it in the response
           const token = jwt.sign(user, 'your_jwt_secret');
           return res.json({user, token});
        });
    })(req, res);

};

// export const login = passport.authenticate('jwt', { session: false });

export const logout = (req: Request, res: Response) => {
  req.logout();
  res.status(200);
  // @TODO destroy the token here
  res.json({ status: 'success', msg: 'You are now logged out! 👋' });
};

export const isLoggedIn = (req: Request, res: Response, next: NextFunction) => {
  const token: string = req.headers['x-access-token'] as string;

  if (!token) {
    return res.status(401).json({ auth: false, message: 'No token provided.' });
  }

  jwt.verify(token, SECRET, (err, decoded: any) => {
    if (err) {
      return res.status(500).json({ auth: false, message: 'Failed to authenticate token.' });
    }

    User.findById(decoded.id, { password: 0 }, (err, user) => {
      if (err) {
        return res.status(500).send('There was a problem finding the user.');
      }
      if (!user) {
        return res.status(404).send('No user found.');
      }
      res.status(200).send(user);
    });
  });
  // first check if the user is authenticated
  if (req.isAuthenticated()) {
    next(); // carry on! They are logged in!
    return;
  }
  res.status(200).json({ status: 'error', msg: 'Oops you must be logged in to do that!' });
};

exports.forgot = async (req: Request, res: Response) => {
  // 1. See if a user with that email exists
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    req.flash('error', 'No account with that email exists.');
    return res.redirect('/login');
  }
  // 2. Set reset tokens and expiry on their account
  (user as any).resetPasswordToken = crypto.randomBytes(20).toString('hex');
  (user as any).resetPasswordExpires = Date.now() + 3600000; // 1 hour from now
  await user.save();
  // 3. Send them an email with the token
  const resetURL = `http://${req.headers.host}/account/reset/${(user as any).resetPasswordToken}`;
  await mail.send({
    user,
    filename: 'password-reset',
    subject: 'Password Reset',
    resetURL
  });
  // 4. redirect to login page
  res.json({ status: 'success', msg: 'You have been emailed a password reset link.' });
};

export const reset = async (req: Request, res: Response) => {
  const user = await User.findOne({
    resetPasswordToken: req.params.token,
    resetPasswordExpires: { $gt: Date.now() }
  });
  if (!user) {
    return res.json({ status: 'error', msg: 'Password reset is invalid or has expired' });
  }
  // if there is a user, show the rest password form
  res.json({ status: 'success', msg: 'password reset .' });
};

export const confirmedPasswords = (req: Request, res: Response, next: NextFunction) => {
  if (req.body.password === req.body['password-confirm']) {
    next(); // keepit going!
    return;
  }
  res.status(401);
  res.json({ status: 'error', msg: 'Passwords do not match!' });
};

export const update = async (req: Request, res: Response) => {
  const user = await User.findOne({
    resetPasswordToken: req.params.token,
    resetPasswordExpires: { $gt: Date.now() }
  });

  if (!user) {
    res.status(401);
    return res.json({ status: 'error', msg: 'Password reset is invalid or has expired' });
  }

  const setPassword = promisify((user as any).setPassword).bind(user);
  await setPassword(req.body.password);
  (user as any).resetPasswordToken = undefined;
  (user as any).resetPasswordExpires = undefined;
  const updatedUser = await user.save();
  await (req as any).login(updatedUser);
  res.json({ status: 'success', msg: '💃 Nice! Your password has been reset! You are now logged in!' });
};