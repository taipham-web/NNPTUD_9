const mongoose = require('mongoose');
const exceljs = require('exceljs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Utility to create a delay (to avoid rate limits)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Require existing schemas
const userModel = require('./schemas/users');
const roleModel = require('./schemas/roles');

const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: "35a21380d26118",
    pass: "86b4cb072d501f"
  }
});

async function main() {
    try {
        // 1. Connect to MongoDB
        await mongoose.connect('mongodb://localhost:27017/NNPTUD-C6');
        console.log("Connected to MongoDB successfully!");

        // 2. Find or create the 'USER' role
        let userRole = await roleModel.findOne({ name: { $regex: /^user$/i }, isDeleted: false });
        
        if (!userRole) {
            console.log("Role 'USER' not found, creating a new one...");
            userRole = new roleModel({ name: 'USER', description: 'Default user role' });
            await userRole.save();
        }

        // 3. Read the 'user.xlsx' file
        // Ensure you have an user.xlsx file in the same directory, 
        // Header: column A = Username, column B = Email
        console.log("Đang đọc file user.xlsx...");
        const workbook = new exceljs.Workbook();
        await workbook.xlsx.readFile('user.xlsx');
        
        // Use the first sheet
        const worksheet = workbook.worksheets[0]; 
        let importedCount = 0;

        // 4. Iterate through rows (starting from row 2 to skip headers)
        for (let i = 2; i <= worksheet.rowCount; i++) {
            const row = worksheet.getRow(i);
            const username = row.getCell(1).text?.trim(); // Column A
            const email = row.getCell(2).text?.trim();    // Column B

            if (!username || !email) {
                // Skip empty lines or improperly formatted rows
                continue; 
            }

            // Check if user already exists
            const existingUser = await userModel.findOne({ 
                $or: [{ username: username }, { email: email }] 
            });

            if (existingUser) {
                console.log(`[SKIP] User '${username}' or email '${email}' đã tồn tại.`);
                continue;
            }

            // 5. Generate 16-character random password
            // 8 bytes in hex format produces exactly 16 characters
            const plainPassword = crypto.randomBytes(8).toString('hex');

            // 6. Create the user
            const newUser = new userModel({
                username: username,
                email: email, // Validated by schema match rule
                password: plainPassword, // The pre-save hook in user schema will automatically hash this
                role: userRole._id,
                fullName: username, // Optional
                status: true
            });

            await newUser.save();
            console.log(`[SUCCESS] Đã tạo user: ${username}`);

            // 7. Send email with the password via Mailtrap
            try {
                const mailOptions = {
                    from: '"Mailtrap Test" <hello@demomailtrap.com>',
                    to: email,
                    subject: "Thông tin tài khoản mới của bạn",
                    text: `Chào ${username},\n\nTài khoản của bạn đã được khởi tạo thành công.\nMật khẩu đăng nhập của bạn là: ${plainPassword}\n\nVui lòng đổi mật khẩu sau khi đăng nhập.`,
                    html: `<p>Chào <b>${username}</b>,</p>
                           <p>Tài khoản của bạn đã được khởi tạo thành công.</p>
                           <p>Mật khẩu đăng nhập của bạn là: <br/> <b style="font-size: 18px; color: blue;">${plainPassword}</b></p>
                           <p>Vui lòng đổi mật khẩu sau khi đăng nhập.</p>`
                };

                await transporter.sendMail(mailOptions);
                console.log(`[EMAIL] Đã gửi thư chứa mật khẩu tới: ${email}`);
            } catch (mailError) {
                console.error(`[LỖI EMAIL] Không thể gửi email cho ${email}. Lỗi: ${mailError.message}`);
                console.log(`[CẢNH BÁO] User ${username} vẫn được tạo thành công! (Nhưng không gửi được mail)`);
            }
            
            importedCount++;
            
            // Tạm dừng 1 giây lặp để không bị dính giới hạn "Too many emails per second" của Mailtrap
            await sleep(1000);
        }

        console.log(`===============================================`);
        console.log(`Import hoàn tất! Đã tạo thành công ${importedCount} tài khoản.`);

    } catch (error) {
        console.error("Lỗi trong quá trình import:", error.message);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB.");
    }
}

main();
