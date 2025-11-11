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

function parseWishlistIssue(issue, labels) {
  const isApproved = labels.some((label) => label.name === "approved-wishlist");
  const body = issue.body || "";

  // Extract all sections from the issue body (which is the source of truth)
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

    const issues = await octokit.paginate("GET /repos/{owner}/{repo}/issues", {
      owner: "oss-wishlist",
      repo: "wishlists",
      state: "open",
      per_page: 100,
    });

    console.log(`✓ Found ${issues.length} open issues`);

    const wishlists = issues
      .filter((issue) => !issue.pull_request)
      .map((issue) => parseWishlistIssue(issue, issue.labels));

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
