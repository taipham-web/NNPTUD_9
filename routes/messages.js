var express = require("express");
var router = express.Router();
let multer = require("multer");
let path = require("path");
let mongoose = require("mongoose");
let { checkLogin } = require("../utils/authHandler");
let messageModel = require("../schemas/messages");
let userModel = require("../schemas/users");

let storageSetting = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    let ext = path.extname(file.originalname);
    let name =
      Date.now() + "-" + Math.round(Math.random() * 2000_000_000) + ext;
    cb(null, name);
  },
});

let uploadFile = multer({
  storage: storageSetting,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

router.get("/", checkLogin, async function (req, res, next) {
  try {
    let currentUserId = new mongoose.Types.ObjectId(String(req.user._id));

    let result = await messageModel.aggregate([
      {
        $match: {
          $or: [{ from: currentUserId }, { to: currentUserId }],
        },
      },
      {
        $addFields: {
          otherUser: {
            $cond: [{ $eq: ["$from", currentUserId] }, "$to", "$from"],
          },
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
      {
        $group: {
          _id: "$otherUser",
          lastMessage: { $first: "$$ROOT" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $unwind: {
          path: "$user",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          user: {
            _id: "$user._id",
            username: "$user.username",
            fullName: "$user.fullName",
            avatarUrl: "$user.avatarUrl",
          },
          lastMessage: 1,
        },
      },
      {
        $sort: {
          "lastMessage.createdAt": -1,
        },
      },
    ]);

    res.send(result);
  } catch (error) {
    res.status(400).send({ message: error.message });
  }
});

router.get("/:userID", checkLogin, async function (req, res, next) {
  try {
    let currentUserId = String(req.user._id);
    let targetUserId = req.params.userID;

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      res.status(400).send({ message: "userID khong hop le" });
      return;
    }

    let messages = await messageModel
      .find({
        $or: [
          {
            from: currentUserId,
            to: targetUserId,
          },
          {
            from: targetUserId,
            to: currentUserId,
          },
        ],
      })
      .sort({ createdAt: 1 })
      .populate({
        path: "from",
        select: "username fullName avatarUrl",
      })
      .populate({
        path: "to",
        select: "username fullName avatarUrl",
      });

    res.send(messages);
  } catch (error) {
    res.status(400).send({ message: error.message });
  }
});

router.post(
  "/",
  checkLogin,
  uploadFile.single("file"),
  async function (req, res, next) {
    try {
      let from = String(req.user._id);
      let to = req.body.to;

      if (!to || !mongoose.Types.ObjectId.isValid(to)) {
        res.status(400).send({ message: "to khong hop le" });
        return;
      }

      let toUser = await userModel.findById(to);
      if (!toUser || toUser.isDeleted) {
        res.status(404).send({ message: "khong tim thay user nhan" });
        return;
      }

      let messageContent;
      if (req.file) {
        messageContent = {
          type: "file",
          text: req.file.path.replace(/\\/g, "/"),
        };
      } else if (req.body.text && req.body.text.trim()) {
        messageContent = {
          type: "text",
          text: req.body.text.trim(),
        };
      } else {
        res.status(400).send({ message: "can co file hoac text" });
        return;
      }

      let newMessage = new messageModel({
        from: from,
        to: to,
        messageContent: messageContent,
      });
      await newMessage.save();

      let savedMessage = await messageModel
        .findById(newMessage._id)
        .populate({
          path: "from",
          select: "username fullName avatarUrl",
        })
        .populate({
          path: "to",
          select: "username fullName avatarUrl",
        });

      let io = req.app.get("io");
      if (io) {
        io.to(from).emit("message:new", savedMessage);
        if (from !== to) {
          io.to(to).emit("message:new", savedMessage);
        }
      }

      res.status(201).send(savedMessage);
    } catch (error) {
      res.status(400).send({ message: error.message });
    }
  },
);

module.exports = router;
