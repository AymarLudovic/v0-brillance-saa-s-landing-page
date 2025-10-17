import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { token, files, projectName } = req.body;

  try {
    const response = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        files: Object.entries(files).map(([path, data]) => ({ file: path, data })),
        target: "production",
      }),
    });

    const data = await response.json();

    if (data.error) throw new Error(data.error.message);

    res.status(200).json({
      success: true,
      deploymentId: data.id,
      url: `https://${data.url}`,
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
        }
  
