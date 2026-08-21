import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// useGSAP keeps its own reference to the gsap core it was bundled against;
// registering it here pins that reference to *this* core instance so it
// can't drift from the one ScrollTrigger and our components use.
gsap.registerPlugin(ScrollTrigger, useGSAP)

export { gsap, ScrollTrigger, useGSAP }
