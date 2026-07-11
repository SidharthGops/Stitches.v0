import axios from "axios";
import FormData from "form-data";

export async function removeBackground(imageBuffer) {
    const form = new FormData();

    form.append("image_file", imageBuffer, {
        filename: "garment.png"
    });

    form.append("size", "auto");

    const response = await axios.post(
        "https://api.remove.bg/v1.0/removebg",
        form,
        {
            headers: {
                ...form.getHeaders(),
                "X-Api-Key": process.env.REMOVE_BG_KEY
            },
            responseType: "arraybuffer"
        }
    );

    return Buffer.from(response.data);
}