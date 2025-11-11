#!/usr/bin/env node

import { Octokit } from "@octokit/rest";
import fs from "fs";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

function extractSection(body, sectionHeader) {
  const regex = new RegExp(
    `### ${sectionHeader}\n([\\s\\S]*?)(?=###|$)`,
    "i"
  );
  const match = body.match(regex);
  if (!match) return "";
  return match[1].trim();
}

function parseCheckboxes(content) {
  const lines = content.split("\n");
  return lines
    .filter((line) => line.includes("[x]"))
    .map((line) => {
      const match = line.match(/\[x\]\s*(.+?)(?:\s*-|$)/);
      return match ? match[1].trim() : "";
    })
    .filter((item) => item.length > 0);
}

function parseCommaSeparated(content) {
  return content
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function getLatestFormData(issue) {
  try {
    // Fetch all comments for this issue
    let allComments = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const response = await octokit.paginate.iterator(
        "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
        {
          owner: "oss-wishlist",
          repo: "wishlists",
          issue_number: issue.number,
          per_page: perPage,
        }
      );

      for await (const { data } of response) {
        allComments = allComments.concat(data);
      }
      break;
    }

    // Filter for bot comments only
    const botComments = allComments.filter(
      (comment) => comment.user?.login === "oss-wishlist-bot"
    );

    // Find latest comment with form data (contains ### sections)
    const latestBotComment = [...botComments]
      .reverse()
      .find((comment) => comment.body?.includes("###"));

    if (latestBotComment?.body) {
      return latestBotComment.body;
    }

    // Fallback: use issue body (creation data)
    return issue.body || "";
  } catch (error) {
    console.warn(
      `Error fetching comments for issue ${issue.number}:`,
      error.message
    );
    return issue.body || "";
  }
}

async function parseWishlistIssue(issue, labels) {
  const isApproved = labels.some((label) => label.name === "approved-wishlist");
  
  // Get form data: latest bot comment or issue body for edits
  const body = await getLatestFormData(issue);

  // Extract all sections from the form data
  const projectName = extractSection(body, "Project Name").trim();
  const maintainerUsername = extractSection(body, "Maintainer GitHub Username")
    .trim()
    .replace(/^@/, ""); // Remove @ if present
  const repositoryUrl = extractSection(body, "Project Repository").trim();
  const ecosystemsText = extractSection(body, "Package Ecosystems");
  const technologies = parseCommaSeparated(ecosystemsText);
  const servicesText = extractSection(body, "Services Requested");
  const wishes = parseCheckboxes(servicesText);
  const resourcesText = extractSection(body, "Resources Requested");
  const resources = parseCheckboxes(resourcesText);
  const urgencyText = extractSection(body, "Urgency Level");
  const projectSize = extractSection(body, "Project Size").trim();
  const additionalNotes = extractSection(body, "Additional Notes").trim();
  const additionalContext = extractSection(body, "Additional Context").trim();

  // Extract urgency level (convert from format with description to simple value)
  const urgencyMatch = urgencyText.match(/^\s*(.+?)(?:\s*-|$)/m);
  const urgency = urgencyMatch ? urgencyMatch[1].trim() : "";

  return {
    id: issue.number,
    projectName: projectName || `Wishlist: ${issue.title}`,
    repositoryUrl,
    maintainerUsername,
    maintainerAvatarUrl: maintainerUsername
      ? `https://github.com/${maintainerUsername}.png`
      : "",
    approved: isApproved,
    wishes,
    technologies,
    resources,
    urgency,
    projectSize,
    additionalNotes,
    additionalContext,
    status: isApproved ? "approved" : "pending",
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  };
}

async function generateCache() {
  try {
    console.log("📋 Fetching wishlists from GitHub...");

    // Fetch only OPEN issues (closed ones are deleted)
    const issues = await octokit.paginate("GET /repos/{owner}/{repo}/issues", {
      owner: "oss-wishlist",
      repo: "wishlists",
      state: "open",  // This ensures deleted wishlists don't appear
      per_page: 100,
    });

    console.log(`✓ Found ${issues.length} open issues`);

    // Parse all wishlists concurrently (await all promises)
    const wishlists = await Promise.all(
      issues
        .filter((issue) => !issue.pull_request)
        .map((issue) => parseWishlistIssue(issue, issue.labels))
    );

    console.log(`✓ Parsed ${wishlists.length} wishlists`);

    // Generate metadata
    const approvedCount = wishlists.filter((w) => w.approved).length;
    const allTechnologies = [
      ...new Set(wishlists.flatMap((w) => w.technologies)),
    ].sort();
    const allServices = [...new Set(wishlists.flatMap((w) => w.wishes))].sort();

    const cacheData = {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      totalWishlists: wishlists.length,
      approvedCount,
      pendingCount: wishlists.length - approvedCount,
      ecosystemStats: allTechnologies.reduce((acc, tech) => {
        acc[tech] = wishlists.filter((w) => w.technologies.includes(tech))
          .length;
        return acc;
      }, {}),
      serviceStats: allServices.reduce((acc, service) => {
        acc[service] = wishlists.filter((w) => w.wishes.includes(service))
          .length;
        return acc;
      }, {}),
      wishlists,
    };

    fs.writeFileSync("all-wishlists.json", JSON.stringify(cacheData, null, 2));

    console.log("✓ Cache generated successfully");
    console.log(
      `  - ${approvedCount} approved wishlists`
    );
    console.log(
      `  - ${wishlists.length - approvedCount} pending wishlists`
    );
    console.log(
      `  - ${allTechnologies.length} unique technologies`
    );
    console.log(`  - ${allServices.length} unique services`);
  } catch (error) {
    console.error("❌ Error generating cache:", error);
    process.exit(1);
  }
}

generateCache();
