import puppeteer from "puppeteer";
import axios from "axios";
import fs from "fs-extra";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

// --- Configuration (same as before) ---
const BASE_EPISODE_URL_TEMPLATE =
    "https://your-url/naruto-shippuden-episode-{episode_num}-english-dubbed";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOWNLOAD_FOLDER = path.join(__dirname, "Naruto_Shippuden_Downloads");
const REQUEST_TIMEOUT = 70000;
const DOWNLOAD_DELAY = 7000;
const HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
};

// --- readline and question (same as before) ---
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
const question = (query) =>
    new Promise((resolve) => rl.question(query, resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getVideoSrcWithPuppeteer(episodePageUrl, episodeNum) {
    console.log(`Launching browser for episode page: ${episodePageUrl}`);
    let browser = null;
    let page = null; // Define page in a broader scope for error handling

    try {
        browser = await puppeteer.launch({
            headless: true, // Set to false to see the browser
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
            ],
        });
        page = await browser.newPage(); // Assign to the broader scoped variable
        await page.setUserAgent(HEADERS["User-Agent"]);
        await page.setViewport({ width: 1280, height: 800 });

        console.log(`Navigating to ${episodePageUrl}...`);
        await page.goto(episodePageUrl, {
            waitUntil: "networkidle2",
            timeout: REQUEST_TIMEOUT,
        });

        console.log(
            "Page loaded. Waiting a bit more for dynamic content (5s)...",
        );
        await new Promise((r) => setTimeout(r, 5000)); // Compatible wait

        let videoSrc = null;
        const videoSelector = "video#video-js_html5_api"; // Target the actual video tag
        const videoContainerSelector = "div#video-js"; // Its common container

        // Attempt 1: Look for video directly in the main page
        console.log("Attempt 1: Looking for video directly in main page...");
        try {
            // Wait for the video container to be present in the main page's DOM
            await page.waitForSelector(videoContainerSelector, {
                timeout: 15000,
            });
            console.log(
                `Video container "${videoContainerSelector}" found in main page.`,
            );

            videoSrc = await page.evaluate((sel) => {
                const videoElement = document.querySelector(sel);
                return videoElement ? videoElement.src : null;
            }, videoSelector);

            if (videoSrc) {
                console.log(
                    `Found video source directly in main page: ${videoSrc.substring(
                        0,
                        70,
                    )}...`,
                );
            } else {
                console.log(
                    "Video container found in main page, but video tag or src not extracted.",
                );
            }
        } catch (e) {
            console.log(
                `Video container not found directly in main page (Attempt 1): ${
                    e.message.split("\n")[0]
                }`,
            );
        }

        // Attempt 2: If not found directly, look for it in the specific iframe
        if (!videoSrc) {
            console.log(
                "Attempt 2: Video not found in main page, looking for iframe...",
            );
            const iframeSelector =
                'iframe[src*="embed.watchanimesub.net"], iframe.vjs_iframe';
            console.log(`Looking for iframe with selector: ${iframeSelector}`);

            let frameHandle;
            try {
                frameHandle = await page.waitForSelector(iframeSelector, {
                    timeout: 20000, // Timeout for finding the iframe itself
                });
            } catch (e) {
                console.log(
                    `Video iframe not found on the page (Attempt 2): ${
                        e.message.split("\n")[0]
                    }`,
                );
                // No need to proceed if iframe isn't found
            }

            if (frameHandle) {
                const frame = await frameHandle.contentFrame();
                if (frame) {
                    console.log("Successfully switched to iframe context.");
                    try {
                        // Now, inside the iframe, look for the video
                        console.log(
                            `Waiting for video container in iframe: ${videoContainerSelector}`,
                        );
                        await frame.waitForSelector(videoContainerSelector, {
                            timeout: 20000, // Timeout within the iframe
                        });
                        console.log(
                            `Video container "${videoContainerSelector}" found in iframe.`,
                        );

                        videoSrc = await frame.evaluate((sel) => {
                            const videoElement = document.querySelector(sel);
                            return videoElement ? videoElement.src : null;
                        }, videoSelector);

                        if (videoSrc) {
                            console.log(
                                `Found video source in iframe: ${videoSrc.substring(0, 70)}...`,
                            );
                        } else {
                            console.log(
                                "Video container found in iframe, but video tag or src not extracted.",
                            );
                            const iframeHtmlContent = await frame.content();
                            const debugIframeHtmlPath = path.join(
                                DOWNLOAD_FOLDER,
                                `debug_iframe_html_ep${episodeNum}.html`,
                            );
                            await fs.writeFile(
                                debugIframeHtmlPath,
                                iframeHtmlContent,
                            );
                            console.log(
                                `Debug Iframe HTML saved to ${debugIframeHtmlPath}`,
                            );
                        }
                    } catch (e) {
                        console.log(
                            `Error finding video within iframe (Attempt 2): ${
                                e.message.split("\n")[0]
                            }`,
                        );
                        try {
                            const iframeHtmlContent = await frame.content();
                            const debugIframeHtmlPath = path.join(
                                DOWNLOAD_FOLDER,
                                `debug_iframe_html_ep${episodeNum}_error.html`,
                            );
                            await fs.writeFile(
                                debugIframeHtmlPath,
                                iframeHtmlContent,
                            );
                            console.log(
                                `Debug Iframe HTML (on error) saved to ${debugIframeHtmlPath}`,
                            );
                        } catch (debugErr) {
                            console.log(
                                "Could not save iframe debug HTML on error.",
                            );
                        }
                    }
                } else {
                    console.log("Could not get content frame of the iframe.");
                }
            } else if (!videoSrc) {
                // Only log if iframe wasn't found AND videoSrc is still null
                console.log(
                    "Video iframe not found, and video not found on main page either.",
                );
            }
        }

        // Final check and return
        if (videoSrc) {
            return videoSrc;
        } else {
            console.log(
                "Video source NOT found after all attempts (main page and iframe).",
            );
            const screenshotPath = path.join(
                DOWNLOAD_FOLDER,
                `debug_screenshot_ep${episodeNum}_final_fail.png`,
            );
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`Debug screenshot saved to ${screenshotPath}`);
            const htmlContent = await page.content();
            const debugHtmlPath = path.join(
                DOWNLOAD_FOLDER,
                `debug_html_ep${episodeNum}_final_fail.html`,
            );
            await fs.writeFile(debugHtmlPath, htmlContent);
            console.log(
                `Debug Main Page HTML (after all attempts) saved to ${debugHtmlPath}`,
            );
            return null;
        }
    } catch (error) {
        console.error(
            `Critical error in Puppeteer for ${episodePageUrl}: ${error.message}`,
        );
        if (page && episodeNum) {
            try {
                const screenshotPath = path.join(
                    DOWNLOAD_FOLDER,
                    `debug_screenshot_ep${episodeNum}_critical_error.png`,
                );
                await page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(
                    `Debug screenshot on critical error saved to ${screenshotPath}`,
                );
            } catch (ssError) {
                console.error(
                    "Could not save screenshot on critical error:",
                    ssError.message,
                );
            }
        }
        return null;
    } finally {
        if (browser) {
            console.log("Closing browser...");
            await browser.close();
        }
    }
}

// --- downloadVideo function (same as your previous Puppeteer version) ---
async function downloadVideo(videoUrl, outputPath, episodeNum) {
    if (await fs.pathExists(outputPath)) {
        console.log(
            `Episode ${episodeNum} (${path.basename(
                outputPath,
            )}) already exists. Skipping.`,
        );
        return true;
    }
    console.log(
        `Starting download for Episode ${episodeNum} from ${videoUrl.substring(
            0,
            70,
        )}...`,
    );
    const writer = fs.createWriteStream(outputPath);
    try {
        const response = await axios({
            method: "get",
            url: videoUrl,
            responseType: "stream",
            headers: HEADERS,
            timeout: REQUEST_TIMEOUT * 4,
        });
        let downloadedSize = 0;
        const totalSize = parseInt(
            response.headers["content-length"] || "0",
            10,
        );
        response.data.on("data", (chunk) => {
            downloadedSize += chunk.length;
            if (totalSize > 0) {
                const progress = (downloadedSize / totalSize) * 100;
                process.stdout.write(
                    `Downloading Episode ${episodeNum}: ${progress.toFixed(
                        2,
                    )}% complete\r`,
                );
            } else {
                process.stdout.write(
                    `Downloading Episode ${episodeNum}: ${(
                        downloadedSize /
                        1024 /
                        1024
                    ).toFixed(2)} MB downloaded\r`,
                );
            }
        });
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on("finish", () => {
                process.stdout.write("\n");
                console.log(
                    `Successfully downloaded Episode ${episodeNum} to ${outputPath}`,
                );
                resolve(true);
            });
            writer.on("error", (err) => {
                process.stdout.write("\n");
                console.error(
                    `Error writing video file for Episode ${episodeNum}: ${err.message}`,
                );
                fs.remove(outputPath).catch((removeErr) =>
                    console.error(
                        `Could not remove partial file ${outputPath}: ${removeErr.message}`,
                    ),
                );
                reject(err);
            });
            response.data.on("error", (err) => {
                process.stdout.write("\n");
                console.error(
                    `Error during download stream for Episode ${episodeNum}: ${err.message}`,
                );
                fs.remove(outputPath).catch((removeErr) =>
                    console.error(
                        `Could not remove partial file ${outputPath}: ${removeErr.message}`,
                    ),
                );
                reject(err);
            });
        });
    } catch (error) {
        process.stdout.write("\n");
        console.error(
            `Error downloading video for Episode ${episodeNum}: ${error.message}`,
        );
        await fs
            .remove(outputPath)
            .catch((removeErr) =>
                console.error(
                    `Could not remove partial file ${outputPath}: ${removeErr.message}`,
                ),
            );
        return false;
    }
}

// --- getEpisodeRange function (same as before) ---
async function getEpisodeRange() {
    try {
        const startEpisodeStr = await question(
            "Enter the start episode number: ",
        );
        const endEpisodeStr = await question("Enter the end episode number: ");
        const startEpisode = parseInt(startEpisodeStr, 10);
        const endEpisode = parseInt(endEpisodeStr, 10);

        if (
            isNaN(startEpisode) ||
            isNaN(endEpisode) ||
            startEpisode <= 0 ||
            endEpisode < startEpisode
        ) {
            console.log(
                "Invalid episode range. Please enter positive numbers with end >= start.",
            );
            return null;
        }
        return { startEpisode, endEpisode };
    } catch (error) {
        console.log("Invalid input. Please enter numbers only.");
        return null;
    }
}

// --- Main Script (largely the same, calls the new getVideoSrcWithPuppeteer) ---
async function main() {
    console.log(
        "--- Naruto Shippuden Bulk Downloader (Node.js + Puppeteer v4 - flexible) ---",
    );
    console.log(
        "IMPORTANT: Please read the disclaimer in the script before use.",
    );
    // ... other console logs ...
    console.log("-".repeat(40));

    const episodeRange = await getEpisodeRange();
    if (!episodeRange) {
        rl.close();
        return;
    }

    const { startEpisode, endEpisode } = episodeRange;

    await fs.ensureDir(DOWNLOAD_FOLDER);
    console.log(`Downloads will be saved to: ${path.resolve(DOWNLOAD_FOLDER)}`);

    let downloadCount = 0;
    const batchSize = 10; // For logging

    for (
        let i = 0, episodeNum = startEpisode;
        episodeNum <= endEpisode;
        i++, episodeNum++
    ) {
        console.log(`\n--- Processing Episode ${episodeNum} ---`);

        const episodePageUrl = BASE_EPISODE_URL_TEMPLATE.replace(
            "{episode_num}",
            episodeNum.toString(),
        );

        const videoSrcUrl = await getVideoSrcWithPuppeteer(
            episodePageUrl,
            episodeNum,
        );

        if (videoSrcUrl) {
            const outputFilename = `Naruto_Shippuden_Episode_${episodeNum
                .toString()
                .padStart(3, "0")}.mp4`;
            const outputPath = path.join(DOWNLOAD_FOLDER, outputFilename);

            if (await downloadVideo(videoSrcUrl, outputPath, episodeNum)) {
                downloadCount++;
            }
        } else {
            console.log(
                `Could not find video source for Episode ${episodeNum}. Skipping. (Check debug files if any were created)`,
            );
        }

        if (episodeNum < endEpisode) {
            console.log(
                `Waiting for ${DOWNLOAD_DELAY / 1000} seconds before next episode...`,
            );
            await sleep(DOWNLOAD_DELAY);
        }
        if ((i + 1) % batchSize === 0 && episodeNum < endEpisode) {
            console.log(
                `\n--- Processed a batch of ${batchSize} episodes. Continuing... ---`,
            );
        }
    }

    console.log("\n--- Download Process Complete ---");
    console.log(`Successfully downloaded ${downloadCount} episodes.`);
    console.log(`Files are located in: ${path.resolve(DOWNLOAD_FOLDER)}`);
    rl.close();
}

main().catch((err) => {
    console.error("A critical error occurred in main:", err);
    rl.close();
});
