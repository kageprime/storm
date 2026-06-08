// E2E test — runs against live Storm API
// Usage: node e2e-test.mjs

const API = 'http://127.0.0.1:3000/api'

let TOKEN = ''
let USER_ID = ''
let PROJECT_ID = ''
let GOAL_ID = ''
const STEP_TIMEOUT = 120_000 // 2 min per step
const GOAL_TIMEOUT  = 300_000 // 5 min per goal

// ─── Helpers ───

async function api(method, path, body, expectStatus) {
  const headers = { 'Content-Type': 'application/json' }
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (expectStatus && res.status !== expectStatus) {
    const text = await res.text()
    throw new Error(`Expected ${expectStatus} got ${res.status}: ${text}`)
  }
  return res
}

async function json(method, path, body, expectStatus) {
  const res = await api(method, path, body, expectStatus)
  return res.json()
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// Stream goal events until done/error/timeout, calling handlers for each event type
async function streamEvents(goalId, handlers) {
  const stream = await api('GET', `/projects/${PROJECT_ID}/goals/${goalId}/stream`)
  const reader = stream.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const startTime = Date.now()

  while (true) {
    if (Date.now() - startTime > GOAL_TIMEOUT) {
      console.log('  ⏰ Goal timed out')
      return
    }

    let chunk
    try {
      const result = await reader.read()
      if (result.done) break
      chunk = result.value
    } catch {
      break
    }

    buf += decoder.decode(chunk, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const event = JSON.parse(line.slice(6))
        const fn = handlers[event.type]
        if (fn) await fn(event)
      } catch { /* ignore parse errors */ }
    }
  }
}

// ─── Scenario 1: Smoke Test — "Hello Storm" HTML page ───

async function testSmokeTest() {
  console.log('\n═══ Scenario 1: Smoke Test — Hello Storm HTML ═══')

  const goal = await json('POST', `/projects/${PROJECT_ID}/goals`, {
    goalText: 'Create a single HTML file called index.html in the root that displays "Hello Storm" in a centered, styled heading with a blue background.',
  }, 202)
  GOAL_ID = goal.goal.id
  console.log(`  Goal submitted: ${GOAL_ID}`)
  console.log(`  Status: ${goal.goal.status} | Steps: ${goal.goal.totalSteps}`)

  // Stream events
  let planApproved = false
  let stepsCompleted = 0
  let totalSteps = 0
  let hasFileEdit = false
  let hasToolCall = false

  await streamEvents(GOAL_ID, {
    status_change: async (event) => {
      console.log(`  Status: ${event.data.status}`)
      if (event.data.status === 'awaiting_approval' && !planApproved) {
        planApproved = true
        totalSteps = event.data.totalSteps || totalSteps
        console.log('  ✅ Approving plan...')
        await json('POST', `/projects/${PROJECT_ID}/goals/${GOAL_ID}/steer`, { action: 'approve' })
      }
    },
    plan_ready: (event) => {
      totalSteps = event.data.totalSteps || event.data.plan?.length || 0
      console.log(`  📋 Plan ready: ${totalSteps} steps`)
    },
    step_start: (event) => {
      console.log(`  ▶ Step ${event.data.step}: ${event.data.description}`)
    },
    step_complete: (event) => {
      stepsCompleted++
      const icon = event.data.success ? '✅' : '❌'
      console.log(`  ${icon} Step ${event.data.step} complete (${stepsCompleted}/${totalSteps})`)
    },
    tool_call: () => { hasToolCall = true },
    file_edit: (event) => {
      hasFileEdit = true
      if (event.data.file) console.log(`  📝 File edited: ${event.data.file}`)
    },
    done: (event) => {
      console.log(`  🏁 Done: ${event.data.message}`)
    },
    steering_needed: async (event) => {
      const opts = event.data.options?.map(o => o.action).join(', ')
      console.log(`  🎯 Steering needed: [${opts}]`)
      if (event.data.options?.some(o => o.action === 'approve')) {
        console.log('  ✅ Auto-approving plan...')
        await json('POST', `/projects/${PROJECT_ID}/goals/${GOAL_ID}/steer`, { action: 'approve' })
      }
    },
    error: (event) => {
      console.log(`  ❌ Error: ${event.data.message}`)
    },
  })

  // Check goal status
  const final = await json('GET', `/projects/${PROJECT_ID}/goals/${GOAL_ID}`)
  const goalStatus = final.goal.status
  console.log(`\n  📊 Final status: ${goalStatus}`)

  // Verify
  const checks = [
    { name: 'Goal completed', pass: goalStatus === 'completed' },
    { name: 'File edit events emitted', pass: hasFileEdit },
    { name: 'Tool call events emitted', pass: hasToolCall },
    { name: 'Steps completed', pass: stepsCompleted > 0 },
  ]

  let allPassed = true
  for (const c of checks) {
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}`)
    if (!c.pass) allPassed = false
  }

  // Verify file exists
  const files = await json('GET', `/projects/${PROJECT_ID}/files`)
  console.log(`  Files in sandbox: ${files.files?.length || 0}`)
  const hasIndexHtml = files.files?.some(f => f.name === 'index.html' || f.path === 'index.html')
  console.log(`  ${hasIndexHtml ? '✅' : '❌'} index.html exists`)
  if (!hasIndexHtml) allPassed = false

  // Verify file content
  if (hasIndexHtml) {
    const fRes = await api('GET', `/projects/${PROJECT_ID}/files/index.html`)
    const content = await fRes.text()
    const hasHelloStorm = content.includes('Hello Storm')
    console.log(`  ${hasHelloStorm ? '✅' : '❌'} Content contains "Hello Storm"`)
    if (!hasHelloStorm) allPassed = false
  }

  console.log(`\n  ${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`)
  return allPassed
}

// ─── Scenario 2: STEM Visualization — Three.js Cube ───

async function testStemViz() {
  console.log('\n═══ Scenario 2: STEM Visualization — Three.js Cube ═══')

  const goal = await json('POST', `/projects/${PROJECT_ID}/goals`, {
    goalText: 'Create an interactive 3D rotating cube using Three.js loaded from CDN. Save it as three-cube.html in the root. The cube should rotate smoothly and have different colors on each face.',
  }, 202)
  GOAL_ID = goal.goal.id
  console.log(`  Goal submitted: ${GOAL_ID}`)

  let planApproved = false
  let allPassed = true

  await streamEvents(GOAL_ID, {
    status_change: async (event) => {
      if (event.data.status === 'awaiting_approval' && !planApproved) {
        planApproved = true
        console.log('  ✅ Plan approved')
        await json('POST', `/projects/${PROJECT_ID}/goals/${GOAL_ID}/steer`, { action: 'approve' })
      }
    },
    step_start: (event) => {
      console.log(`  ▶ Step ${event.data.step}: ${event.data.description}`)
    },
    step_complete: (event) => {
      console.log(`  ${event.data.success ? '✅' : '❌'} Step ${event.data.step}`)
      if (!event.data.success) allPassed = false
    },
    file_edit: (event) => { console.log(`  📝 ${event.data.file}`) },
    done: (event) => { console.log(`  🏁 ${event.data.message}`) },
    error: (event) => {
      console.log(`  ❌ ${event.data.message}`)
      allPassed = false
    },
    steering_needed: async (event) => {
      if (event.data.options?.some(o => o.action === 'approve') && !planApproved) {
        planApproved = true
        console.log('  ✅ Plan approved')
        await json('POST', `/projects/${PROJECT_ID}/goals/${GOAL_ID}/steer`, { action: 'approve' })
      }
    },
  })

  // Check files
  const files = await json('GET', `/projects/${PROJECT_ID}/files`)
  const hasCubeHtml = files.files?.some(f => f.name.includes('three') || (f.name === 'three-cube.html'))
  console.log(`  ${hasCubeHtml ? '✅' : '❌'} HTML file exists`)
  if (!hasCubeHtml) allPassed = false

  if (hasCubeHtml) {
    const fileName = files.files.find(f => f.name.includes('three')) || files.files.find(f => f.name === 'three-cube.html')
    if (fileName) {
      const fRes = await api('GET', `/projects/${PROJECT_ID}/files/${fileName.name}`)
      const content = await fRes.text()
      const hasThreeJs = content.includes('three') || content.includes('Three') || content.includes('THREE')
      const hasRotate = content.includes('rotate') || content.includes('animation')
      console.log(`  ${hasThreeJs ? '✅' : '❌'} References Three.js`)
      console.log(`  ${hasRotate ? '✅' : '❌'} Has rotation/animation`)
      if (!hasThreeJs) allPassed = false
    }
  }

  const final = await json('GET', `/projects/${PROJECT_ID}/goals/${GOAL_ID}`)
  console.log(`  📊 Final status: ${final.goal.status}`)
  if (final.goal.status !== 'completed') allPassed = false

  console.log(`\n  ${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`)
  return allPassed
}

// ─── Scenario 3: Multi-file web app ───

async function testMultiFileApp() {
  console.log('\n═══ Scenario 3: Multi-File Web App ═══')

  const goal = await json('POST', `/projects/${PROJECT_ID}/goals`, {
    goalText: 'Build a mini web app with three files: index.html, style.css, and app.js. The app should be a counter with increment/decrement buttons, styled nicely with CSS, and the logic in JavaScript.',
  }, 202)
  GOAL_ID = goal.goal.id
  console.log(`  Goal submitted: ${GOAL_ID}`)

  let planApproved = false
  let toolCallCount = 0
  let fileEditCount = 0
  let allPassed = true

  await streamEvents(GOAL_ID, {
    status_change: async (event) => {
      if (event.data.status === 'awaiting_approval' && !planApproved) {
        planApproved = true
        console.log('  ✅ Plan approved')
        await json('POST', `/projects/${PROJECT_ID}/goals/${GOAL_ID}/steer`, { action: 'approve' })
      }
    },
    step_start: (event) => { console.log(`  ▶ Step ${event.data.step}: ${event.data.description}`) },
    step_complete: (event) => {
      console.log(`  ${event.data.success ? '✅' : '❌'} Step ${event.data.step}`)
      if (!event.data.success) allPassed = false
    },
    file_edit: (event) => { fileEditCount++; console.log(`  📝 ${event.data.file}`) },
    tool_call: () => { toolCallCount++ },
    done: (event) => { console.log(`  🏁 ${event.data.message}`) },
    error: (event) => { console.log(`  ❌ ${event.data.message}`); allPassed = false },
    steering_needed: async (event) => {
      if (event.data.options?.some(o => o.action === 'approve') && !planApproved) {
        planApproved = true
        console.log('  ✅ Plan approved')
        await json('POST', `/projects/${PROJECT_ID}/goals/${GOAL_ID}/steer`, { action: 'approve' })
      }
    },
  })

  // Check files
  const files = await json('GET', `/projects/${PROJECT_ID}/files`)

  function hasFile(name) {
    return files.files?.some(f => f.name === name) ?? false
  }

  console.log(`  ${hasFile('index.html') ? '✅' : '❌'} index.html`)
  console.log(`  ${hasFile('style.css') ? '✅' : '❌'} style.css`)
  console.log(`  ${hasFile('app.js') ? '✅' : '❌'} app.js`)

  if (!hasFile('index.html') || !hasFile('style.css') || !hasFile('app.js')) allPassed = false
  console.log(`  📊 File edits: ${fileEditCount}, Tool calls: ${toolCallCount}`)

  const final = await json('GET', `/projects/${PROJECT_ID}/goals/${GOAL_ID}`)
  console.log(`  📊 Final status: ${final.goal.status}`)
  if (final.goal.status !== 'completed') allPassed = false

  console.log(`\n  ${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`)
  return allPassed
}

// ─── Scenario 4: Failure + Steering ───

async function testFailureSteering() {
  console.log('\n═══ Scenario 4: Failure + Steering ═══')

  // Submit a goal that's likely to fail — invalid syntax goal
  const goal = await json('POST', `/projects/${PROJECT_ID}/goals`, {
    goalText: 'Create a file called broken-syntax.js that contains deliberately invalid JavaScript with syntax errors, then try to run it with node.',
  }, 202)
  GOAL_ID = goal.goal.id
  console.log(`  Goal submitted: ${GOAL_ID}`)

  let planApproved = false
  let sawSteeringNeed = false
  let steered = false
  let allPassed = true

  await streamEvents(GOAL_ID, {
    status_change: async (event) => {
      if (event.data.status === 'awaiting_approval' && !planApproved) {
        planApproved = true
        console.log('  ✅ Plan approved')
        await json('POST', `/projects/${PROJECT_ID}/goals/${GOAL_ID}/steer`, { action: 'approve' })
      }
      if (event.data.status === 'steering') console.log('  🎯 Entered steering mode')
    },
    step_start: (event) => { console.log(`  ▶ Step ${event.data.step}: ${event.data.description}`) },
    step_complete: (event) => { console.log(`  ${event.data.success ? '✅' : '❌'} Step ${event.data.step}`) },
    steering_needed: async (event) => {
      sawSteeringNeed = true
      const actions = event.data.options?.map(o => `${o.action} (${o.label})`).join(', ') || ''
      console.log(`  🎯 Steering needed: [${actions}]`)

      if (!steered && event.data.options?.some(o => o.action === 'retry')) {
        steered = true
        console.log('  🔄 Steering: retrying step...')
        await json('POST', `/projects/${PROJECT_ID}/goals/${GOAL_ID}/steer`, { action: 'retry' })
      } else if (!steered && event.data.options?.some(o => o.action === 'skip')) {
        steered = true
        console.log('  ⏭️ Steering: skipping step...')
        await json('POST', `/projects/${PROJECT_ID}/goals/${GOAL_ID}/steer`, { action: 'skip' })
      }
    },
    done: (event) => { console.log(`  🏁 ${event.data.message}`) },
    error: (event) => { console.log(`  ❌ ${event.data.message}`) },
  })

  console.log(`  ${sawSteeringNeed ? '✅' : '❌'} Steering was triggered`)
  console.log(`  ${steered ? '✅' : '❌'} Steering action was sent`)
  if (!sawSteeringNeed) allPassed = false

  const final = await json('GET', `/projects/${PROJECT_ID}/goals/${GOAL_ID}`)
  console.log(`  📊 Final status: ${final.goal.status}`)

  console.log(`\n  ${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`)
  return allPassed
}

// ─── Scenario 5: Mid-execution Message ───

async function testMidExecMessage() {
  console.log('\n═══ Scenario 5: Mid-Execution Message ═══')

  const goal = await json('POST', `/projects/${PROJECT_ID}/goals`, {
    goalText: 'Create a file called greeting.html that displays "Hello World" in large text with a gradient background.',
  }, 202)
  GOAL_ID = goal.goal.id
  console.log(`  Goal submitted: ${GOAL_ID}`)

  let planApproved = false
  let sentMessage = false
  let allPassed = true

  await streamEvents(GOAL_ID, {
    status_change: async (event) => {
      if (event.data.status === 'executing' && !sentMessage) {
        sentMessage = true
        console.log('  💬 Sending mid-exec message: "Make the background purple"')
        await json('POST', `/projects/${PROJECT_ID}/goals/${GOAL_ID}/steer`, {
          action: 'message',
          payload: { text: 'Make the background purple instead of gradient.' },
        })
      }
      if (event.data.status === 'awaiting_approval' && !planApproved) {
        planApproved = true
        console.log('  ✅ Plan approved')
        await json('POST', `/projects/${PROJECT_ID}/goals/${GOAL_ID}/steer`, { action: 'approve' })
      }
    },
    step_start: (event) => { console.log(`  ▶ Step ${event.data.step}: ${event.data.description}`) },
    step_complete: (event) => { console.log(`  ${event.data.success ? '✅' : '❌'} Step ${event.data.step}`) },
    user_message: (event) => { console.log(`  💬 User message relayed: ${event.data.text}`) },
    done: (event) => { console.log(`  🏁 ${event.data.message}`) },
    error: (event) => { console.log(`  ❌ ${event.data.message}`); allPassed = false },
    steering_needed: async (event) => {
      if (event.data.options?.some(o => o.action === 'approve') && !planApproved) {
        planApproved = true
        console.log('  ✅ Plan approved')
        await json('POST', `/projects/${PROJECT_ID}/goals/${GOAL_ID}/steer`, { action: 'approve' })
      }
    },
  })

  // Verify file content has purple
  const files = await json('GET', `/projects/${PROJECT_ID}/files`)
  const hasGreeting = files.files?.some(f => f.name === 'greeting.html')
  console.log(`  ${hasGreeting ? '✅' : '❌'} greeting.html exists`)

  if (hasGreeting) {
    const fRes = await api('GET', `/projects/${PROJECT_ID}/files/greeting.html`)
    const content = await fRes.text()
    const hasPurple = content.toLowerCase().includes('purple')
    console.log(`  ${hasPurple ? '✅' : '❌'} Content has purple (from mid-exec message)`)
  }

  console.log(`  ${sentMessage ? '✅' : '❌'} Mid-exec message sent`)
  if (!sentMessage) allPassed = false

  const final = await json('GET', `/projects/${PROJECT_ID}/goals/${GOAL_ID}`)
  console.log(`  📊 Final status: ${final.goal.status}`)

  console.log(`\n  ${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`)
  return allPassed
}

// ─── Main ───

async function main() {
  console.log('🚀 Storm E2E Test Suite')
  console.log('='.repeat(50))

  // Register
  const reg = await json('POST', '/auth/register', {
    email: `e2e-${Date.now()}@test.com`,
    password: 'test123',
  })
  TOKEN = reg.token
  USER_ID = reg.user.id
  console.log(`✅ Registered as ${reg.user.email}`)

  // Create project
  const proj = await json('POST', '/projects', {
    name: 'E2E Test Project',
  })
  PROJECT_ID = proj.project.id
  console.log(`✅ Project created: ${proj.project.name} (${PROJECT_ID})`)

  let passed = 0
  let failed = 0

  const results = []

  results.push({ name: 'Smoke Test', pass: await testSmokeTest() })
  passed += results[0].pass ? 1 : 0
  failed += results[0].pass ? 0 : 1

  results.push({ name: 'STEM Viz', pass: await testStemViz() })
  passed += results[1].pass ? 1 : 0
  failed += results[1].pass ? 0 : 1

  results.push({ name: 'Multi-File App', pass: await testMultiFileApp() })
  passed += results[2].pass ? 1 : 0
  failed += results[2].pass ? 0 : 1

  results.push({ name: 'Failure + Steering', pass: await testFailureSteering() })
  passed += results[3].pass ? 1 : 0
  failed += results[3].pass ? 0 : 1

  results.push({ name: 'Mid-Exec Message', pass: await testMidExecMessage() })
  passed += results[4].pass ? 1 : 0
  failed += results[4].pass ? 0 : 1

  console.log('\n' + '='.repeat(50))
  console.log('📊 E2E Test Results')
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}`)
  }
  console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`)

  // Cleanup
  console.log('\n🧹 Cleaning up...')
  await json('DELETE', `/projects/${PROJECT_ID}`)
  console.log('✅ Project deleted')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('❌ Fatal:', err)
  process.exit(1)
})
